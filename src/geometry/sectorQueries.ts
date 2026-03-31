import type { Linedef } from '../types';
import { maps } from '../state/appState';
import { vertexToLinedefs } from '../state/indices';
import { buildSectorLoopIds, buildSectorPoly, pointInSector } from './cycleFinder';
import { polyArea } from './hitTest';

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

/** Find which sector a point is inside (accounting for holes via even-odd rule). */
export function findEnclosingSector(
  px: number, py: number,
  sectorIds: Iterable<string>,
): string | null {
  for (const sid of sectorIds) {
    if (pointInSector(px, py, sid)) return sid;
  }
  return null;
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

function collectSectorsFromVertex(vid: string): Set<string> {
  const sectors = new Set<string>();
  const lds = vertexToLinedefs.get(vid);
  if (!lds) return sectors;
  for (const ldId of lds) {
    const ld = maps.linedefs.get(ldId);
    if (!ld) continue;
    for (const sdId of [ld.frontSide, ld.backSide]) {
      if (!sdId) continue;
      const sd = maps.sidedefs.get(sdId);
      if (sd?.sector) sectors.add(sd.sector);
    }
  }
  return sectors;
}

/**
 * Check if any sector's boundary loop contains both vertex IDs.
 */
export function anyBoundaryContainsBoth(vid1: string, vid2: string): boolean {
  const candidates = collectSectorsFromVertex(vid1);
  for (const sid of candidates) {
    for (const loop of buildSectorLoopIds(sid)) {
      if (loop.includes(vid1) && loop.includes(vid2)) return true;
    }
  }
  return false;
}
