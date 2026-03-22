import { describe, it, expect, beforeEach, vi } from 'vitest';
import { maps } from '../../src/state/appState';
import { onLinedefAdded, onLinedefChanged, onLinedefRemoved, onSidedefAdded, onSidedefChanged, onSidedefRemoved, rebuildIndices } from '../../src/state/indices';
import type { DrawVertex } from '../../src/types';

// ── Firebase mock ──
// Must be hoisted before any imports that use firebase
let keyCounter = 0;
function nextKey() { return 'k' + (++keyCounter); }

vi.mock('../../src/config/firebase', () => {
  const makeRef = (basePath: string) => ({
    push: (val: any) => {
      const key = nextKey();
      // Simulate Firebase listener: add to maps
      const col = basePath.replace('map/', '');
      if ((maps as any)[col]) {
        (maps as any)[col].set(key, { ...val });
      }
      // Maintain indices
      if (col === 'linedefs' && val.v1 && val.v2) {
        onLinedefAdded(key, val.v1, val.v2);
      } else if (col === 'sidedefs' && val.sector) {
        onSidedefAdded(key, val.sector);
      }
      // Return a thenable with .key accessible synchronously (like Firebase SDK)
      const result = Promise.resolve({ key }) as any;
      result.key = key;
      return result;
    },
    child: (id: string) => ({
      update: (val: any) => {
        const col = basePath.replace('map/', '');
        if ((maps as any)[col]) {
          const existing = (maps as any)[col].get(id);
          if (existing) {
            const oldV1 = existing.v1, oldV2 = existing.v2;
            const oldSector = existing.sector;
            (maps as any)[col].set(id, { ...existing, ...val });
            // Maintain indices
            if (col === 'linedefs') {
              const updated = (maps as any)[col].get(id);
              onLinedefChanged(id, updated.v1, updated.v2, oldV1, oldV2);
            } else if (col === 'sidedefs') {
              const updated = (maps as any)[col].get(id);
              onSidedefChanged(id, updated.sector, oldSector);
            }
          }
        }
        return Promise.resolve();
      },
      remove: () => {
        const col = basePath.replace('map/', '');
        if (col === 'linedefs') {
          const existing = (maps as any)[col]?.get(id);
          if (existing) onLinedefRemoved(id, existing.v1, existing.v2);
        } else if (col === 'sidedefs') {
          const existing = (maps as any)[col]?.get(id);
          if (existing) onSidedefRemoved(id, existing.sector);
        }
        if ((maps as any)[col]) (maps as any)[col].delete(id);
        return Promise.resolve();
      },
    }),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    on: () => {},
    once: () => Promise.resolve({ val: () => null }),
    onDisconnect: () => ({ remove: () => {} }),
  });

  return {
    db: { ref: (p: string) => makeRef(p || '') },
    mapRef: (col: string) => makeRef('map/' + col),
  };
});

// Mock history (no-op)
vi.mock('../../src/history/undoRedo', () => ({
  beginAction: () => {},
  record: () => {},
  endAction: () => {},
}));

// Mock UI and browser-dependent modules (no-op)
vi.mock('../../src/ui/toast', () => ({ showToast: () => {} }));
vi.mock('../../src/canvas/renderer', () => ({ draw: () => {} }));
vi.mock('../../src/ui/propertiesPanel', () => ({ renderPanel: () => {} }));
vi.mock('../../src/ui/thingBrowser', () => ({ getSelectedThingType: () => 1, setSelectedThingType: () => {} }));
vi.mock('../../src/wad/textureLoader', () => ({
  getTextureDataUrl: () => null,
  isWadLoaded: () => false,
  getSpritePrefixEntry: () => null,
}));

import { createSectorFromPolygon, splitSector } from '../../src/map/mapActions';
import { buildSectorLoopIds, buildSectorPoly } from '../../src/geometry/cycleFinder';

function findVertexAt(x: number, y: number): string | null {
  for (const [id, v] of maps.vertices) {
    if (v.x === x && v.y === y) return id;
  }
  return null;
}

function clearMaps() {
  maps.vertices.clear();
  maps.linedefs.clear();
  maps.sidedefs.clear();
  maps.sectors.clear();
  maps.things.clear();
  rebuildIndices();
  keyCounter = 0;
}

describe('sector drawing', () => {
  beforeEach(() => {
    clearMaps();
  });

  it('creates a triangle sector with 3 linedefs all assigned to the new sector', async () => {
    const chain: DrawVertex[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];

    await createSectorFromPolygon(chain);

    // Should have 3 vertices
    expect(maps.vertices.size).toBe(3);

    // Should have 1 sector
    expect(maps.sectors.size).toBe(1);
    const sectorId = [...maps.sectors.keys()][0];

    // Should have 3 linedefs
    expect(maps.linedefs.size).toBe(3);

    // Should have 3 sidedefs (one per linedef, single-sided)
    expect(maps.sidedefs.size).toBe(3);

    // Every sidedef should reference the same sector
    const sectorRefs = [...maps.sidedefs.values()].map(sd => sd.sector);
    expect(sectorRefs.every(s => s === sectorId)).toBe(true);

    // Every linedef should have a frontSide that exists in sidedefs
    for (const [, ld] of maps.linedefs) {
      expect(ld.frontSide).toBeTruthy();
      expect(maps.sidedefs.has(ld.frontSide)).toBe(true);
      // Single-sided: no backSide
      expect(ld.backSide).toBeFalsy();
    }

    // The sector boundary loop should contain all 3 vertices
    const loops = buildSectorLoopIds(sectorId);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(3);

    // The sector polygon should be valid
    const poly = buildSectorPoly(sectorId);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBe(3);
  });

  it('split square then draw adjacent sector across the split', async () => {
    // Step 1: Create square ABCD (clockwise in y-up coords)
    //   A(0,100) → B(100,100) → C(100,0) → D(0,0)
    const squareChain: DrawVertex[] = [
      { x: 0, y: 100 },     // A
      { x: 100, y: 100 },   // B
      { x: 100, y: 0 },     // C
      { x: 0, y: 0 },       // D
    ];
    await createSectorFromPolygon(squareChain);

    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    const vidA = findVertexAt(0, 100)!;
    const vidB = findVertexAt(100, 100)!;
    const vidC = findVertexAt(100, 0)!;
    const vidD = findVertexAt(0, 0)!;
    expect(vidA).toBeTruthy();
    expect(vidB).toBeTruthy();
    expect(vidC).toBeTruthy();
    expect(vidD).toBeTruthy();

    const originalSid = [...maps.sectors.keys()][0];

    // Step 2: Split with diagonal from A to C
    const splitChain: DrawVertex[] = [
      { x: 0, y: 100, existingId: vidA },
      { x: 100, y: 0, existingId: vidC },
    ];
    await splitSector(splitChain, originalSid);

    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(5); // 4 original + 1 diagonal

    // Verify: one sector has boundary {A,B,C}, the other {A,C,D}
    const sids = [...maps.sectors.keys()];
    const loopSets = sids.map(sid =>
      buildSectorLoopIds(sid).map(l => new Set(l))
    );

    const hasVerts = (loops: Set<string>[], verts: string[]) =>
      loops.some(l => l.size === verts.length && verts.every(v => l.has(v)));

    expect(hasVerts(loopSets[0], [vidA, vidB, vidC]) ||
           hasVerts(loopSets[1], [vidA, vidB, vidC])).toBe(true);
    expect(hasVerts(loopSets[0], [vidA, vidC, vidD]) ||
           hasVerts(loopSets[1], [vidA, vidC, vidD])).toBe(true);

    // Step 3: Draw new sector A → E(outside) → C
    //   E(50,200) is above and outside the square
    //   The closing edge C→A overlaps the two-sided diagonal,
    //   so expandMissingEdges should route through B instead.
    const newChain: DrawVertex[] = [
      { x: 0, y: 100, existingId: vidA },
      { x: 200, y: 200 },                    // E — new, outside
      { x: 100, y: 0, existingId: vidC },
    ];
    await createSectorFromPolygon(newChain);

    expect(maps.sectors.size).toBe(3);

    const vidE = findVertexAt(200, 200)!;
    expect(vidE).toBeTruthy();
    expect(maps.vertices.size).toBe(5);

    // Find the newest sector
    const newSid = [...maps.sectors.keys()].find(s => !sids.includes(s))!;
    expect(newSid).toBeTruthy();

    // The new sector's boundary should be {A, E, C, B}
    const newLoops = buildSectorLoopIds(newSid);
    expect(newLoops.length).toBe(1);
    const newLoop = new Set(newLoops[0]);
    expect(newLoop.size).toBe(4);
    expect(newLoop.has(vidA)).toBe(true);
    expect(newLoop.has(vidE)).toBe(true);
    expect(newLoop.has(vidC)).toBe(true);
    expect(newLoop.has(vidB)).toBe(true);
  });
});
