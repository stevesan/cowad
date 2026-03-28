import { vi, beforeEach, expect } from 'vitest';
import { maps } from '../../src/state/appState';
import { onLinedefAdded, onLinedefChanged, onLinedefRemoved, onSidedefAdded, onSidedefChanged, onSidedefRemoved, rebuildIndices } from '../../src/state/indices';
import type { Point } from '../../src/types';
import { buildSectorPolys, pointInSector } from '../../src/geometry/cycleFinder';

// ── Firebase mock ──
let keyCounter = 0;
function nextKey() { return 'k' + (++keyCounter); }

vi.mock('../../src/config/firebase', () => {
  const makeRef = (basePath: string) => ({
    push: (val: any) => {
      const key = nextKey();
      const col = basePath.replace('map/', '');
      if ((maps as any)[col]) (maps as any)[col].set(key, { ...val });
      if (col === 'linedefs' && val.v1 && val.v2) onLinedefAdded(key, val.v1, val.v2);
      else if (col === 'sidedefs' && val.sector) onSidedefAdded(key, val.sector);
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
            const oldV1 = existing.v1, oldV2 = existing.v2, oldSector = existing.sector;
            (maps as any)[col].set(id, { ...existing, ...val });
            if (col === 'linedefs') { const u = (maps as any)[col].get(id); onLinedefChanged(id, u.v1, u.v2, oldV1, oldV2); }
            else if (col === 'sidedefs') { const u = (maps as any)[col].get(id); onSidedefChanged(id, u.sector, oldSector); }
          }
        }
        return Promise.resolve();
      },
      remove: () => {
        const col = basePath.replace('map/', '');
        if (col === 'linedefs') { const e = (maps as any)[col]?.get(id); if (e) onLinedefRemoved(id, e.v1, e.v2); }
        else if (col === 'sidedefs') { const e = (maps as any)[col]?.get(id); if (e) onSidedefRemoved(id, e.sector); }
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

vi.mock('../../src/history/undoRedo', () => ({ beginAction: () => {}, record: () => {}, endAction: () => {} }));
vi.mock('../../src/ui/toast', () => ({ showToast: () => {} }));
vi.mock('../../src/canvas/renderer', () => ({ draw: () => {} }));
vi.mock('../../src/ui/propertiesPanel', () => ({ renderPanel: () => {} }));
vi.mock('../../src/ui/thingBrowser', () => ({ getSelectedThingType: () => 1, setSelectedThingType: () => {} }));
vi.mock('../../src/wad/textureLoader', () => ({ getTextureDataUrl: () => null, isWadLoaded: () => false, getSpritePrefixEntry: () => null }));

export function clearMaps() {
  maps.vertices.clear();
  maps.linedefs.clear();
  maps.sidedefs.clear();
  maps.sectors.clear();
  maps.things.clear();
  rebuildIndices();
  keyCounter = 0;
}

export function findVertexAt(x: number, y: number): string | null {
  for (const [id, v] of maps.vertices) if (v.x === x && v.y === y) return id;
  return null;
}

export function findSectorAt(x: number, y: number): string | null {
  for (const [sid] of maps.sectors) if (pointInSector(x, y, sid)) return sid;
  return null;
}

beforeEach(() => { clearMaps(); });

// ── Sector overlap detection ──

function segsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  if ((ax === cx && ay === cy) || (ax === dx && ay === dy) ||
      (bx === cx && by === cy) || (bx === dx && by === dy)) return false;
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function pip(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function polyEdges(poly: Point[]): [Point, Point][] {
  const edges: [Point, Point][] = [];
  for (let i = 0; i < poly.length; i++)
    edges.push([poly[i], poly[(i + 1) % poly.length]]);
  return edges;
}

function isSharedVertex(v: Point, other: Point[]): boolean {
  return other.some(o => o.x === v.x && o.y === v.y);
}

/**
 * Assert that no two sectors in the current map have overlapping area.
 * Checks every pair for: (1) properly crossing edges, (2) non-shared
 * vertex of one polygon inside the other.
 */
export function expectNoSectorOverlaps(): void {
  const sids = [...maps.sectors.keys()];
  const polys = new Map<string, Point[][]>();
  for (const sid of sids) polys.set(sid, buildSectorPolys(sid));

  for (let i = 0; i < sids.length; i++) {
    for (let j = i + 1; j < sids.length; j++) {
      const a = sids[i], b = sids[j];
      const loopsA = polys.get(a)!, loopsB = polys.get(b)!;
      const allVertsA = loopsA.flat(), allVertsB = loopsB.flat();

      // Edge crossing check
      for (const polyA of loopsA) {
        for (const polyB of loopsB) {
          for (const [a1, a2] of polyEdges(polyA)) {
            for (const [b1, b2] of polyEdges(polyB)) {
              if (segsCross(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) {
                expect.fail(
                  `Sectors ${a} and ${b} overlap: edges (${a1.x},${a1.y})-(${a2.x},${a2.y}) ` +
                  `and (${b1.x},${b1.y})-(${b2.x},${b2.y}) cross`
                );
              }
            }
          }
        }
      }

      // Non-shared vertex containment check (uses even-odd across all loops)
      for (const v of allVertsA) {
        if (isSharedVertex(v, allVertsB)) continue;
        let hits = 0;
        for (const polyB of loopsB) if (pip(v.x, v.y, polyB)) hits++;
        if ((hits & 1) === 1) {
          expect.fail(`Sectors ${a} and ${b} overlap: vertex (${v.x},${v.y}) of ${a} is inside ${b}`);
        }
      }
      for (const v of allVertsB) {
        if (isSharedVertex(v, allVertsA)) continue;
        let hits = 0;
        for (const polyA of loopsA) if (pip(v.x, v.y, polyA)) hits++;
        if ((hits & 1) === 1) {
          expect.fail(`Sectors ${a} and ${b} overlap: vertex (${v.x},${v.y}) of ${b} is inside ${a}`);
        }
      }
    }
  }
}
