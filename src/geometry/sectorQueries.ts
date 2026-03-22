import { pointInPoly, polyArea } from './hitTest';
import type { Linedef, Point } from '../types';

/** Find an existing linedef connecting two vertices; report direction. */
export function findExistingLinedef(
  linedefs: ReadonlyMap<string, Linedef>, va: string, vb: string
): { ldId: string; sameDirection: boolean } | null {
  for (const [lid, ld] of linedefs) {
    if (ld.v1 === va && ld.v2 === vb) return { ldId: lid, sameDirection: true };
    if (ld.v1 === vb && ld.v2 === va) return { ldId: lid, sameDirection: false };
  }
  return null;
}

/** Find the smallest sector polygon enclosing a point. */
export function findEnclosingSector(
  px: number, py: number,
  sectorIds: Iterable<string>,
  buildSectorPoly: (sid: string) => Point[] | null,
): string | null {
  let bestId: string | null = null, bestArea = Infinity;
  for (const sid of sectorIds) {
    const poly = buildSectorPoly(sid);
    if (poly && pointInPoly(px, py, poly)) {
      const a = polyArea(poly);
      if (a < bestArea) { bestArea = a; bestId = sid; }
    }
  }
  return bestId;
}

/**
 * Check if merging vidA into vidB would create duplicate linedefs
 * (i.e. two linedefs sharing the same pair of endpoints).
 */
export function mergeWouldDuplicate(
  linedefs: ReadonlyMap<string, Linedef>,
  vidA: string, vidB: string, connectingLid: string,
): boolean {
  const neighborsOfA = new Set<string>();
  const neighborsOfB = new Set<string>();
  for (const [lid, ld] of linedefs) {
    if (lid === connectingLid) continue;
    if (ld.v1 === vidA) neighborsOfA.add(ld.v2);
    if (ld.v2 === vidA) neighborsOfA.add(ld.v1);
    if (ld.v1 === vidB) neighborsOfB.add(ld.v2);
    if (ld.v2 === vidB) neighborsOfB.add(ld.v1);
  }
  for (const c of neighborsOfA) {
    if (c !== vidB && neighborsOfB.has(c)) return true;
  }
  return false;
}
