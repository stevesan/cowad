import { maps } from '../state/appState';
import { pointInPoly, polyArea } from './hitTest';
import type { Point } from '../types';

/** Return all boundary loops for a sector as vertex ID arrays. */
export function buildSectorLoopIds(sid: string): string[][] {
  const edges: [string, string][] = [];
  maps.linedefs.forEach(ld => {
    const fs = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
    const bs = ld.backSide  ? maps.sidedefs.get(ld.backSide)  : null;
    if (fs && fs.sector === sid) edges.push([ld.v1, ld.v2]);
    if (bs && bs.sector === sid) edges.push([ld.v2, ld.v1]);
  });
  if (!edges.length) return [];

  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  }

  const usedEdges = new Set<string>();
  const loops: string[][] = [];

  for (const [startA, startB] of edges) {
    const key = `${startA}>${startB}`;
    if (usedEdges.has(key)) continue;
    usedEdges.add(key);

    const chain: string[] = [startA];
    let cur = startB;

    for (let i = 0; i < edges.length + 1; i++) {
      if (cur === startA) break;
      chain.push(cur);
      const nexts = (adj.get(cur) || []).filter(n => !usedEdges.has(`${cur}>${n}`));
      if (!nexts.length) break;
      usedEdges.add(`${cur}>${nexts[0]}`);
      cur = nexts[0];
    }

    if (chain.length >= 3) loops.push(chain);
  }

  return loops;
}

/** Return all boundary loops for a sector (outer + holes). */
export function buildSectorPolys(sid: string): Point[][] {
  const edges: [string, string][] = [];
  maps.linedefs.forEach(ld => {
    const fs = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
    const bs = ld.backSide  ? maps.sidedefs.get(ld.backSide)  : null;
    if (fs && fs.sector === sid) edges.push([ld.v1, ld.v2]);
    if (bs && bs.sector === sid) edges.push([ld.v2, ld.v1]);
  });
  if (!edges.length) return [];

  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  }

  const usedEdges = new Set<string>();
  const loops: Point[][] = [];

  for (const [startA, startB] of edges) {
    const key = `${startA}>${startB}`;
    if (usedEdges.has(key)) continue;
    usedEdges.add(key);

    const chain: string[] = [startA];
    let cur = startB;

    for (let i = 0; i < edges.length + 1; i++) {
      if (cur === startA) break;
      chain.push(cur);
      const nexts = (adj.get(cur) || []).filter(n => !usedEdges.has(`${cur}>${n}`));
      if (!nexts.length) break;
      usedEdges.add(`${cur}>${nexts[0]}`);
      cur = nexts[0];
    }

    const poly = chain.map(id => maps.vertices.get(id)).filter((v): v is Point => !!v);
    if (poly.length >= 3) loops.push(poly);
  }

  return loops;
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
