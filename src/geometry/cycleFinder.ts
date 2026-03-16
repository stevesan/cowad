import { maps } from '../state/appState';
import { pointInPoly, polyArea } from './hitTest';
import type { Point } from '../types';

export function buildSectorPoly(sid: string): Point[] | null {
  const edges: [string, string][] = [];
  maps.linedefs.forEach(ld => {
    const fs = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
    const bs = ld.backSide  ? maps.sidedefs.get(ld.backSide)  : null;
    if (fs && fs.sector === sid) edges.push([ld.v1, ld.v2]);
    if (bs && bs.sector === sid) edges.push([ld.v2, ld.v1]);
  });
  if (!edges.length) return null;

  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  }

  const start = edges[0][0];
  const chain: string[] = [start];
  const usedEdge = new Set<string>([`${edges[0][0]}>${edges[0][1]}`]);
  let cur = edges[0][1];
  for (let i = 0; i < edges.length + 1; i++) {
    if (cur === start) break;
    chain.push(cur);
    const nexts = (adj.get(cur) || []).filter(n => !usedEdge.has(`${cur}>${n}`));
    if (!nexts.length) break;
    usedEdge.add(`${cur}>${nexts[0]}`);
    cur = nexts[0];
  }
  return chain.map(id => maps.vertices.get(id)).filter((v): v is Point => !!v);
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
