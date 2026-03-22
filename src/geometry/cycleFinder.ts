import { maps } from '../state/appState';
import { getLinedefsForSector } from '../state/indices';
import { pointInPoly, polyArea } from './hitTest';
import type { Point } from '../types';

/** Return all boundary loops for a sector as vertex ID arrays.
 *  Uses Hierholzer's algorithm to correctly handle pinch vertices
 *  (vertices visited twice in a single boundary loop). */
export function buildSectorLoopIds(sid: string): string[][] {
  const ldIds = getLinedefsForSector(sid);
  if (!ldIds.size) return [];

  // Build adjacency: vertex → list of {angle, neighbor, ldId} sorted by angle
  const adj = new Map<string, { angle: number; vid: string; ldId: string }[]>();
  for (const ldId of ldIds) {
    const ld = maps.linedefs.get(ldId);
    if (!ld) continue;
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) continue;
    if (!adj.has(ld.v1)) adj.set(ld.v1, []);
    if (!adj.has(ld.v2)) adj.set(ld.v2, []);
    adj.get(ld.v1)!.push({ angle: Math.atan2(v2.y - v1.y, v2.x - v1.x), vid: ld.v2, ldId });
    adj.get(ld.v2)!.push({ angle: Math.atan2(v1.y - v2.y, v1.x - v2.x), vid: ld.v1, ldId });
  }
  for (const edges of adj.values()) {
    edges.sort((a, b) => a.angle - b.angle);
  }

  // Hierholzer's algorithm per connected component
  const usedLd = new Set<string>();
  const loops: string[][] = [];

  for (const startVid of adj.keys()) {
    if (!adj.get(startVid)!.some(e => !usedLd.has(e.ldId))) continue;

    const circuit: string[] = [];
    const stack: string[] = [startVid];
    const ptr = new Map<string, number>();

    while (stack.length > 0) {
      const v = stack[stack.length - 1];
      const edges = adj.get(v)!;
      let p = ptr.get(v) ?? 0;
      while (p < edges.length && usedLd.has(edges[p].ldId)) p++;
      if (p < edges.length) {
        usedLd.add(edges[p].ldId);
        ptr.set(v, p + 1);
        stack.push(edges[p].vid);
      } else {
        ptr.set(v, p);
        circuit.push(stack.pop()!);
      }
    }

    circuit.reverse();
    if (circuit.length > 1 && circuit[0] === circuit[circuit.length - 1]) {
      circuit.pop();
    }
    if (circuit.length >= 3) loops.push(circuit);
  }

  return loops;
}

/** Return all boundary loops for a sector (outer + holes). */
export function buildSectorPolys(sid: string): Point[][] {
  return buildSectorLoopIds(sid)
    .map(loop => loop.map(id => maps.vertices.get(id)).filter((v): v is Point => !!v))
    .filter(poly => poly.length >= 3);
}

/** Return the outer boundary polygon for a sector (largest loop). */
export function buildSectorPoly(sid: string): Point[] | null {
  const loops = buildSectorPolys(sid);
  if (!loops.length) return null;
  let best = loops[0], bestArea = polyArea(best);
  for (let i = 1; i < loops.length; i++) {
    const a = polyArea(loops[i]);
    if (a > bestArea) { bestArea = a; best = loops[i]; }
  }
  return best;
}

/** True if the point is inside the sector, accounting for holes (even-odd rule). */
export function pointInSector(px: number, py: number, sid: string): boolean {
  const loops = buildSectorPolys(sid);
  let count = 0;
  for (const loop of loops) {
    if (pointInPoly(px, py, loop)) count++;
  }
  return (count & 1) === 1;
}

export function findEnclosingCycle(wx: number, wy: number): string[] | null {
  const adj = new Map<string, Set<string>>();
  maps.linedefs.forEach(ld => {
    if (!adj.has(ld.v1)) adj.set(ld.v1, new Set());
    if (!adj.has(ld.v2)) adj.set(ld.v2, new Set());
    adj.get(ld.v1)!.add(ld.v2);
    adj.get(ld.v2)!.add(ld.v1);
  });
  if (!adj.size) return null;

  const MAX_DEPTH  = 18;
  const MAX_CYCLES = 300;
  const cycles: string[][] = [];
  const seenNorm = new Set<string>();

  function normalizeCycle(c: string[]): string {
    const min = c.reduce((a, b) => (a < b ? a : b));
    const i   = c.indexOf(min);
    const rot = [...c.slice(i), ...c.slice(0, i)];
    const rev = [rot[0], ...rot.slice(1).reverse()];
    const s1  = rot.join('|'), s2 = rev.join('|');
    return s1 < s2 ? s1 : s2;
  }

  for (const start of adj.keys()) {
    if (cycles.length >= MAX_CYCLES) break;
    const path: string[] = [start];
    const visited = new Set<string>([start]);

    (function dfs(): void {
      if (cycles.length >= MAX_CYCLES || path.length > MAX_DEPTH) return;
      const cur = path[path.length - 1];
      for (const n of adj.get(cur)!) {
        if (path.length >= 3 && n === start) {
          const norm = normalizeCycle(path);
          if (!seenNorm.has(norm)) { seenNorm.add(norm); cycles.push([...path]); }
          continue;
        }
        if (visited.has(n)) continue;
        visited.add(n); path.push(n);
        dfs();
        path.pop(); visited.delete(n);
      }
    })();
  }

  let bestCycle: string[] | null = null, bestArea = Infinity;
  for (const cycle of cycles) {
    const poly = cycle.map(id => maps.vertices.get(id)).filter((v): v is Point => !!v);
    if (poly.length < 3 || !pointInPoly(wx, wy, poly)) continue;
    const a = polyArea(poly);
    if (a < bestArea) { bestArea = a; bestCycle = cycle; }
  }
  return bestCycle;
}
