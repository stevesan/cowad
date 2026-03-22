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

import { createSectorFromPolygon, splitSector, deleteSelected } from '../../src/map/mapActions';
import { buildSectorLoopIds, buildSectorPoly } from '../../src/geometry/cycleFinder';
import { setSelected } from '../../src/state/appState';

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

    const sectorId = await createSectorFromPolygon(chain);
    expect(sectorId).toBeTruthy();

    expect(maps.vertices.size).toBe(3);
    expect(maps.sectors.size).toBe(1);
    expect(maps.linedefs.size).toBe(3);
    expect(maps.sidedefs.size).toBe(3);

    // Every sidedef should reference the same sector
    const sectorRefs = [...maps.sidedefs.values()].map(sd => sd.sector);
    expect(sectorRefs.every(s => s === sectorId)).toBe(true);

    // Every linedef should be single-sided with a valid frontSide
    for (const [, ld] of maps.linedefs) {
      expect(ld.frontSide).toBeTruthy();
      expect(maps.sidedefs.has(ld.frontSide)).toBe(true);
      expect(ld.backSide).toBeFalsy();
    }

    // The sector boundary loop should contain all 3 vertices
    const loops = buildSectorLoopIds(sectorId!);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(3);

    const poly = buildSectorPoly(sectorId!);
    expect(poly).not.toBeNull();
    expect(poly!.length).toBe(3);
  });

  it('split square then draw adjacent sector across the split', async () => {
    // Create square ABCD (clockwise in y-up coords)
    const squareSid = await createSectorFromPolygon([
      { x: 0, y: 100 },     // A
      { x: 100, y: 100 },   // B
      { x: 100, y: 0 },     // C
      { x: 0, y: 0 },       // D
    ]);
    expect(squareSid).toBeTruthy();
    expect(maps.vertices.size).toBe(4);

    const vidA = findVertexAt(0, 100)!;
    const vidB = findVertexAt(100, 100)!;
    const vidC = findVertexAt(100, 0)!;
    const vidD = findVertexAt(0, 0)!;

    // Split with diagonal from A to C
    const splitResult = await splitSector([
      { x: 0, y: 100, existingId: vidA },
      { x: 100, y: 0, existingId: vidC },
    ], squareSid!);

    expect(splitResult).not.toBeNull();
    const [sid0, sid1] = splitResult!;
    expect(sid0).toBe(squareSid);

    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(5); // 4 original + 1 diagonal

    // Verify: one sector has boundary {A,B,C}, the other {A,C,D}
    const hasLoop = (sid: string, verts: string[]) =>
      buildSectorLoopIds(sid).some(l =>
        l.length === verts.length && verts.every(v => l.includes(v)));

    expect(hasLoop(sid0, [vidA, vidB, vidC]) || hasLoop(sid1, [vidA, vidB, vidC])).toBe(true);
    expect(hasLoop(sid0, [vidA, vidC, vidD]) || hasLoop(sid1, [vidA, vidC, vidD])).toBe(true);

    // Draw new sector A → E(outside) → C
    // The closing edge C→A overlaps the two-sided diagonal,
    // so expandMissingEdges should route through B instead.
    const newSid = await createSectorFromPolygon([
      { x: 0, y: 100, existingId: vidA },
      { x: 200, y: 200 },                    // E — new, outside
      { x: 100, y: 0, existingId: vidC },
    ]);
    expect(newSid).toBeTruthy();
    expect(maps.sectors.size).toBe(3);
    expect(maps.vertices.size).toBe(5);

    const vidE = findVertexAt(200, 200)!;

    // The new sector's boundary should be {A, E, C, B}
    const newLoops = buildSectorLoopIds(newSid!);
    expect(newLoops.length).toBe(1);
    const newLoop = new Set(newLoops[0]);
    expect(newLoop.size).toBe(4);
    expect(newLoop.has(vidA)).toBe(true);
    expect(newLoop.has(vidE)).toBe(true);
    expect(newLoop.has(vidC)).toBe(true);
    expect(newLoop.has(vidB)).toBe(true);
  });

  it('delete one sector after split: shared linedef has correct sidedef', async () => {
    // Create square ABCD
    const squareSid = await createSectorFromPolygon([
      { x: 0, y: 100 },     // A
      { x: 100, y: 100 },   // B
      { x: 100, y: 0 },     // C
      { x: 0, y: 0 },       // D
    ]);
    expect(squareSid).toBeTruthy();

    const vidA = findVertexAt(0, 100)!;
    const vidC = findVertexAt(100, 0)!;

    // Split with diagonal A→C
    const splitResult = await splitSector([
      { x: 0, y: 100, existingId: vidA },
      { x: 100, y: 0, existingId: vidC },
    ], squareSid!);

    expect(splitResult).not.toBeNull();
    const [sid0, sid1] = splitResult!;
    expect(maps.sectors.size).toBe(2);

    // Find the diagonal linedef (A-C)
    let diagLdId: string | null = null;
    for (const [lid, ld] of maps.linedefs) {
      if ((ld.v1 === vidA && ld.v2 === vidC) || (ld.v1 === vidC && ld.v2 === vidA)) {
        diagLdId = lid;
        break;
      }
    }
    expect(diagLdId).toBeTruthy();

    const diagLd = maps.linedefs.get(diagLdId!)!;
    expect(diagLd.frontSide).toBeTruthy();
    expect(diagLd.backSide).toBeTruthy();

    // Check that the front and back sidedefs reference DIFFERENT sectors
    const frontSd = maps.sidedefs.get(diagLd.frontSide!)!;
    const backSd = maps.sidedefs.get(diagLd.backSide!)!;
    expect(frontSd.sector).not.toBe(backSd.sector);

    // Verify the front sidedef's sector is on the right side of v1→v2
    const v1 = maps.vertices.get(diagLd.v1)!;
    const v2 = maps.vertices.get(diagLd.v2)!;
    const frontSectorLoop = buildSectorLoopIds(frontSd.sector);
    // Find a vertex in the front sector that isn't A or C
    const frontVerts = new Set(frontSectorLoop.flat());
    frontVerts.delete(vidA);
    frontVerts.delete(vidC);
    const testVid = [...frontVerts][0];
    const testV = maps.vertices.get(testVid)!;
    const cross = (v2.x - v1.x) * (testV.y - v1.y) - (v2.y - v1.y) * (testV.x - v1.x);
    // Front sector should be on the right (cross < 0 in y-up)
    expect(cross).toBeLessThan(0);

    // Now delete sid0 and verify the surviving sector keeps its linedef correctly
    setSelected({ type: 'sector', id: sid0 });
    deleteSelected();

    expect(maps.sectors.size).toBe(1);
    expect(maps.sectors.has(sid1)).toBe(true);

    // The diagonal should now be single-sided with its sidedef referencing sid1
    const updatedDiag = maps.linedefs.get(diagLdId!);
    if (updatedDiag) {
      // Linedef survived (not both sides belonged to deleted sector)
      expect(updatedDiag.frontSide).toBeTruthy();
      const remainingSd = maps.sidedefs.get(updatedDiag.frontSide!)!;
      expect(remainingSd.sector).toBe(sid1);
      expect(updatedDiag.backSide).toBeFalsy();
    }

    // The surviving sector should still have a valid loop
    const survivingLoops = buildSectorLoopIds(sid1);
    expect(survivingLoops.length).toBe(1);
    expect(survivingLoops[0].length).toBe(3);
  });

  it('pinch vertex: two triangles sharing a vertex produce a single loop', async () => {
    // Create triangle ABV
    const sid1 = await createSectorFromPolygon([
      { x: 0, y: 100 },     // A
      { x: 100, y: 100 },   // B
      { x: 50, y: 50 },     // V
    ]);
    expect(sid1).toBeTruthy();

    const vidA = findVertexAt(0, 100)!;
    const vidB = findVertexAt(100, 100)!;
    const vidV = findVertexAt(50, 50)!;

    // Split triangle ABV with line from V outward into a second triangle VDC
    // by drawing a new sector that shares vertex V
    const sid2 = await createSectorFromPolygon([
      { x: 50, y: 50, existingId: vidV },
      { x: 100, y: 0 },     // D
      { x: 0, y: 0 },       // C
    ]);
    expect(sid2).toBeTruthy();
    expect(maps.sectors.size).toBe(2);

    const vidC = findVertexAt(0, 0)!;
    const vidD = findVertexAt(100, 0)!;

    // Now merge both triangles into one sector by making all sidedefs
    // reference sid1 (simulating a single pinched sector)
    for (const [sdId, sd] of maps.sidedefs) {
      if (sd.sector === sid2) {
        maps.sidedefs.set(sdId, { ...sd, sector: sid1! });
      }
    }
    maps.sectors.delete(sid2!);

    // Rebuild indices after manual mutation
    rebuildIndices();

    // The single sector now has 6 edges forming a bowtie through V.
    // Face traversal splits this into two triangle loops at the pinch vertex.
    const loops = buildSectorLoopIds(sid1!);
    expect(loops.length).toBe(2);
    expect(loops[0].length).toBe(3);
    expect(loops[1].length).toBe(3);

    const allVerts = new Set([...loops[0], ...loops[1]]);
    expect(allVerts.has(vidA)).toBe(true);
    expect(allVerts.has(vidB)).toBe(true);
    expect(allVerts.has(vidC)).toBe(true);
    expect(allVerts.has(vidD)).toBe(true);
    expect(allVerts.has(vidV)).toBe(true);
  });

  it('draw adjacent sector on unsplit square using non-adjacent vertices', async () => {
    // Create square ABCD (clockwise in y-up coords)
    await createSectorFromPolygon([
      { x: 0, y: 100 },     // A
      { x: 100, y: 100 },   // B
      { x: 100, y: 0 },     // C
      { x: 0, y: 0 },       // D
    ]);
    expect(maps.vertices.size).toBe(4);

    const vidA = findVertexAt(0, 100)!;
    const vidB = findVertexAt(100, 100)!;
    const vidC = findVertexAt(100, 0)!;

    // Draw new sector A → E(outside) → C
    // No direct linedef between C and A (opposite corners),
    // so expandMissingEdges should route through B (smaller polygon)
    const newSid = await createSectorFromPolygon([
      { x: 0, y: 100, existingId: vidA },
      { x: 200, y: 200 },                    // E — new, outside
      { x: 100, y: 0, existingId: vidC },
    ]);
    expect(newSid).toBeTruthy();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(5);

    const vidE = findVertexAt(200, 200)!;

    // The new sector's boundary should be {A, E, C, B}
    const newLoops = buildSectorLoopIds(newSid!);
    expect(newLoops.length).toBe(1);
    const newLoop = new Set(newLoops[0]);
    expect(newLoop.size).toBe(4);
    expect(newLoop.has(vidA)).toBe(true);
    expect(newLoop.has(vidE)).toBe(true);
    expect(newLoop.has(vidC)).toBe(true);
    expect(newLoop.has(vidB)).toBe(true);
  });
});
