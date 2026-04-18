import { maps } from '../state/appState';
import { getLinedefsForSector } from '../state/indices';
import { pointInPoly, polyArea } from './hitTest';
import { signedArea2 } from './polygonMath';
import type { Point, Linedef, Vertex, Sidedef } from '../types';
import type { ExportableMap } from '../map/exportableMap';

/** Core PFT algorithm: given a set of linedef IDs and explicit vertex/linedef maps,
 *  returns interior face loops as vertex ID arrays. */
function buildLoopsFromLinedefs(
  ldIds: Set<string>,
  linedefs: Map<string, Linedef>,
  vertices: Map<string, Vertex>,
): string[][] {
  // Build adjacency: vertex → list of {angle, neighbor} sorted by angle (CCW)
  const adj = new Map<string, { angle: number; vid: string }[]>();
  for (const ldId of ldIds) {
    const ld = linedefs.get(ldId);
    if (!ld) continue;
    const v1 = vertices.get(ld.v1);
    const v2 = vertices.get(ld.v2);
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
    const v = vertices.get(vid)!;
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

  const result = loops.filter((_, i) => !loopExterior[i]);

  // Fix winding: outer loop (largest) must be CW (signedArea2 > 0),
  // hole loops must be CCW (signedArea2 < 0).
  if (result.length > 0) {
    const polys = result.map(l => l.map(id => vertices.get(id)!));
    const areas = polys.map(p => signedArea2(p));
    let outerIdx = 0, maxAbs = 0;
    for (let i = 0; i < areas.length; i++) {
      const abs = Math.abs(areas[i]);
      if (abs > maxAbs) { maxAbs = abs; outerIdx = i; }
    }
    if (areas[outerIdx] < 0) result[outerIdx].reverse();
    for (let i = 0; i < result.length; i++) {
      if (i !== outerIdx && areas[i] > 0) result[i].reverse();
    }
  }

  return result;
}

/** Return all boundary loops for a sector as vertex ID arrays.
 *  Uses planar face traversal: at each vertex, edges are sorted by angle
 *  and we always pick the next CW edge from the arrival direction. Each
 *  directed half-edge belongs to exactly one face. The exterior (unbounded)
 *  face of each connected component is identified and removed. */
export function buildSectorLoopIds(sid: string): string[][] {
  const ldIds = getLinedefsForSector(sid);
  if (!ldIds.size) return [];
  return buildLoopsFromLinedefs(ldIds, maps.linedefs, maps.vertices);
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

/** Like buildSectorPolys but reads from an explicit ExportableMap (no global index). */
export function buildSectorPolysFrom(sid: string, m: ExportableMap): Point[][] {
  const sds = new Set<string>();
  for (const [sdId, sd] of m.sidedefs) {
    if ((sd as Sidedef).sector === sid) sds.add(sdId);
  }
  const ldIds = new Set<string>();
  for (const [ldId, ld] of m.linedefs) {
    if ((ld.frontSide && sds.has(ld.frontSide)) || (ld.backSide && sds.has(ld.backSide)))
      ldIds.add(ldId);
  }
  if (!ldIds.size) return [];
  return buildLoopsFromLinedefs(ldIds, m.linedefs, m.vertices)
    .map(loop => loop.map(id => m.vertices.get(id)).filter((v): v is Point => !!v))
    .filter(poly => poly.length >= 3);
}
