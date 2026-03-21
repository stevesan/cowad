import { describe, it, expect, beforeEach, vi } from 'vitest';
import { maps } from '../../src/state/appState';
import { onLinedefAdded, onLinedefChanged, onLinedefRemoved, rebuildIndices } from '../../src/state/indices';
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
      // Maintain reverse index for linedefs
      if (col === 'linedefs' && val.v1 && val.v2) {
        onLinedefAdded(key, val.v1, val.v2);
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
            // Maintain reverse index for linedefs
            if (col === 'linedefs' && (val.v1 || val.v2)) {
              onLinedefChanged(id, val.v1 || existing.v1, val.v2 || existing.v2, existing.v1, existing.v2);
            }
            (maps as any)[col].set(id, { ...existing, ...val });
          }
        }
        return Promise.resolve();
      },
      remove: () => {
        const col = basePath.replace('map/', '');
        if (col === 'linedefs') {
          const existing = (maps as any)[col]?.get(id);
          if (existing) onLinedefRemoved(id, existing.v1, existing.v2);
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

import { createSectorFromPolygon } from '../../src/map/mapActions';
import { buildSectorLoopIds, buildSectorPoly } from '../../src/geometry/cycleFinder';

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
});
