import { maps } from '../state/appState';
import { getLinedefsForSector } from '../state/indices';
import { pointInPoly, polyArea } from './hitTest';
import type { Point } from '../types';

/** Return all boundary loops for a sector as vertex ID arrays.
 *  Uses planar face traversal: at each vertex, edges are sorted by angle
 *  and we always pick the next CW edge from the arrival direction. Each
 *  directed half-edge belongs to exactly one face. The exterior (unbounded)
 *  face of each connected component is identified and removed. */
export function buildSectorLoopIds(sid: string): string[][] {
  const ldIds = getLinedefsForSector(sid);
  if (!ldIds.size) return [];

  // Build adjacency: vertex → list of {angle, neighbor} sorted by angle (CCW)
  const adj = new Map<string, { angle: number; vid: string }[]>();
  for (const ldId of ldIds) {
    const ld = maps.linedefs.get(ldId);
    if (!ld) continue;
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) continue;
    if (!adj.has(ld.v1)) adj.set(ld.v1, []);
    if (!adj.has(ld.v2)) adj.set(ld.v2, []);
    adj.get(ld.v1)!.push({ angle: Math.atan2(v2.y - v1.y, v2.x - v1.x), vid: ld.v2 });
    adj.get(ld.v2)!.push({ angle: Math.atan2(v1.y - v2.y, v1.x - v2.x), vid: ld.v1 });
  }
  for (const edges of adj.values()) {
    edges.sort((a, b) => a.angle - b.angle);
  }

  // Find connected components and each component's rightmost vertex.
  // The exterior face of each component is identified by the half-edge
  // leaving the rightmost vertex (max x, break ties by max y) along
  // its smallest-angle outgoing edge.
  const compOf = new Map<string, number>();
  let numComps = 0;
  for (const v of adj.keys()) {
    if (compOf.has(v)) continue;
    const comp = numComps++;
    const stack = [v];
    while (stack.length) {
      const u = stack.pop()!;
      if (compOf.has(u)) continue;
      compOf.set(u, comp);
      for (const e of adj.get(u)!) {
        if (!compOf.has(e.vid)) stack.push(e.vid);
      }
    }
  }

  const compRight = new Array<string>(numComps).fill('');
  const compBestX = new Array(numComps).fill(-Infinity);
  const compBestY = new Array(numComps).fill(-Infinity);
  for (const [vid, comp] of compOf) {
    const v = maps.vertices.get(vid)!;
    if (v.x > compBestX[comp] || (v.x === compBestX[comp] && v.y > compBestY[comp])) {
      compBestX[comp] = v.x; compBestY[comp] = v.y; compRight[comp] = vid;
    }
  }

  const exteriorHEs = new Set<string>();
  for (let c = 0; c < numComps; c++) {
    const vid = compRight[c];
    const edges = adj.get(vid)!;
    exteriorHEs.add(vid + '|' + edges[0].vid);
  }

  // Planar face traversal: follow "next CW" half-edges.
  const usedHE = new Set<string>();
  const loops: string[][] = [];
  const loopExterior: boolean[] = [];

  for (const [vid, edges] of adj) {
    for (const edge of edges) {
      const startKey = vid + '|' + edge.vid;
      if (usedHE.has(startKey)) continue;

      const loop: string[] = [];
      let isExterior = false;
      let cur = vid, next = edge.vid;

      for (;;) {
        const he = cur + '|' + next;
        if (exteriorHEs.has(he)) isExterior = true;
        usedHE.add(he);
        loop.push(cur);

        // At 'next', find the edge back to 'cur' in the CCW-sorted list,
        // then pick the previous entry (= next CW) as the outgoing edge.
        const nextEdges = adj.get(next)!;
        const arrIdx = nextEdges.findIndex(e => e.vid === cur);
        const nextIdx = (arrIdx - 1 + nextEdges.length) % nextEdges.length;
        cur = next;
        next = nextEdges[nextIdx].vid;

        if (cur === vid && next === edge.vid) break;
        if (loop.length > ldIds.size * 2) break;
      }

      if (loop.length >= 3) {
        loops.push(loop);
        loopExterior.push(isExterior);
      }
    }
  }

  return loops.filter((_, i) => !loopExterior[i]);
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
