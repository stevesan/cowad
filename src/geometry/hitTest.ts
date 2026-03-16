import { maps, zoom } from '../state/appState';
import type { Point } from '../types';

export function nearestVertex(wx: number, wy: number, thresh: number = 12 / zoom): string | null {
  let best: string | null = null, bestD = thresh;
  maps.vertices.forEach((v, id) => {
    const d = Math.hypot(v.x - wx, v.y - wy);
    if (d < bestD) { bestD = d; best = id; }
  });
  return best;
}

export function nearestLinedef(wx: number, wy: number, thresh: number = 8 / zoom): string | null {
  let best: string | null = null, bestD = thresh;
  maps.linedefs.forEach((ld, id) => {
    const v1 = maps.vertices.get(ld.v1), v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) return;
    const d = ptSegDist(wx, wy, v1.x, v1.y, v2.x, v2.y);
    if (d < bestD) { bestD = d; best = id; }
  });
  return best;
}

export function nearestThing(wx: number, wy: number, thresh: number = 24 / zoom): string | null {
  let best: string | null = null, bestD = thresh;
  maps.things.forEach((th, id) => {
    const d = Math.hypot(th.x - wx, th.y - wy);
    if (d < bestD) { bestD = d; best = id; }
  });
  return best;
}

export function ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInPoly(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

export function polyArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}
