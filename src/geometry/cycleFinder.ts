import { maps } from '../state/appState';
import { getLinedefsForSector } from '../state/indices';
import { pointInPoly, polyArea } from './hitTest';
import type { Point } from '../types';

/** Return all boundary loops for a sector as vertex ID arrays. */
export function buildSectorLoopIds(sid: string): string[][] {
  const ldIds = getLinedefsForSector(sid);
  if (!ldIds.size) return [];

  // Build undirected adjacency from linedefs bordering this sector
  const adj = new Map<string, Set<string>>();
  for (const ldId of ldIds) {
    const ld = maps.linedefs.get(ldId);
    if (!ld) continue;
    if (!adj.has(ld.v1)) adj.set(ld.v1, new Set());
    if (!adj.has(ld.v2)) adj.set(ld.v2, new Set());
    adj.get(ld.v1)!.add(ld.v2);
    adj.get(ld.v2)!.add(ld.v1);
  }

  // Trace loops by consuming undirected edges
  const usedEdges = new Set<string>();
  const loops: string[][] = [];

  function edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  for (const [startA, neighbors] of adj) {
    for (const startB of neighbors) {
      const ek = edgeKey(startA, startB);
      if (usedEdges.has(ek)) continue;
      usedEdges.add(ek);

      const chain: string[] = [startA];
      let cur = startB;

      for (let i = 0; i < adj.size + 1; i++) {
        if (cur === startA) break;
        chain.push(cur);
        const nexts = [...(adj.get(cur) || [])].filter(n => !usedEdges.has(edgeKey(cur, n)));
        if (!nexts.length) break;
        usedEdges.add(edgeKey(cur, nexts[0]));
        cur = nexts[0];
      }

      if (chain.length >= 3 && cur === startA) loops.push(chain);
    }
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
