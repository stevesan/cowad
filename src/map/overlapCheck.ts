import { maps } from '../state/appState';
import { buildSectorPolys } from '../geometry/cycleFinder';
import type { Point } from '../types';

export interface SectorOverlap {
  sectorA: string;
  sectorB: string;
  reason: string;
}

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
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
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
 * Find all pairs of sectors whose areas overlap.
 * Checks every pair for: (1) properly crossing edges, (2) non-shared
 * vertex of one polygon inside the other.
 */
export function findSectorOverlaps(): SectorOverlap[] {
  const results: SectorOverlap[] = [];
  const sids = [...maps.sectors.keys()];
  const polys = new Map<string, Point[][]>();
  for (const sid of sids) polys.set(sid, buildSectorPolys(sid));

  for (let i = 0; i < sids.length; i++) {
    for (let j = i + 1; j < sids.length; j++) {
      const a = sids[i], b = sids[j];
      const loopsA = polys.get(a)!, loopsB = polys.get(b)!;
      const allVertsA = loopsA.flat(), allVertsB = loopsB.flat();
      let found = false;

      // Edge crossing check
      outer:
      for (const polyA of loopsA) {
        for (const polyB of loopsB) {
          for (const [a1, a2] of polyEdges(polyA)) {
            for (const [b1, b2] of polyEdges(polyB)) {
              if (segsCross(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) {
                results.push({
                  sectorA: a, sectorB: b,
                  reason: `edges (${a1.x},${a1.y})-(${a2.x},${a2.y}) and (${b1.x},${b1.y})-(${b2.x},${b2.y}) cross`,
                });
                found = true;
                break outer;
              }
            }
          }
        }
      }
      if (found) continue;

      // Non-shared vertex containment check (even-odd across all loops)
      for (const v of allVertsA) {
        if (found) break;
        if (isSharedVertex(v, allVertsB)) continue;
        let hits = 0;
        for (const polyB of loopsB) if (pip(v.x, v.y, polyB)) hits++;
        if ((hits & 1) === 1) {
          results.push({
            sectorA: a, sectorB: b,
            reason: `vertex (${v.x},${v.y}) of sector ${a} is inside sector ${b}`,
          });
          found = true;
        }
      }
      for (const v of allVertsB) {
        if (found) break;
        if (isSharedVertex(v, allVertsA)) continue;
        let hits = 0;
        for (const polyA of loopsA) if (pip(v.x, v.y, polyA)) hits++;
        if ((hits & 1) === 1) {
          results.push({
            sectorA: a, sectorB: b,
            reason: `vertex (${v.x},${v.y}) of sector ${b} is inside sector ${a}`,
          });
          found = true;
        }
      }
    }
  }
  return results;
}
