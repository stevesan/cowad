import { maps } from './appState';

/**
 * Reverse index: vertex ID → set of linedef IDs that use it.
 * Maintained incrementally via the update helpers below.
 */
export const vertexToLinedefs = new Map<string, Set<string>>();

/** Rebuild all indices from scratch (e.g. on initial load). */
export function rebuildIndices(): void {
  vertexToLinedefs.clear();
  maps.linedefs.forEach((ld, id) => {
    addLinedefToIndex(id, ld.v1, ld.v2);
  });
}

/** Call when a linedef is added. */
export function onLinedefAdded(id: string, v1: string, v2: string): void {
  addLinedefToIndex(id, v1, v2);
}

/** Call when a linedef is changed (vertices may have changed). */
export function onLinedefChanged(id: string, v1: string, v2: string, oldV1?: string, oldV2?: string): void {
  // Remove old mappings if vertices changed
  if (oldV1 && oldV1 !== v1) {
    vertexToLinedefs.get(oldV1)?.delete(id);
  }
  if (oldV2 && oldV2 !== v2) {
    vertexToLinedefs.get(oldV2)?.delete(id);
  }
  addLinedefToIndex(id, v1, v2);
}

/** Call when a linedef is removed. */
export function onLinedefRemoved(id: string, v1: string, v2: string): void {
  vertexToLinedefs.get(v1)?.delete(id);
  vertexToLinedefs.get(v2)?.delete(id);
}

function addLinedefToIndex(id: string, v1: string, v2: string): void {
  if (!vertexToLinedefs.has(v1)) vertexToLinedefs.set(v1, new Set());
  if (!vertexToLinedefs.has(v2)) vertexToLinedefs.set(v2, new Set());
  vertexToLinedefs.get(v1)!.add(id);
  vertexToLinedefs.get(v2)!.add(id);
}

/**
 * Find all sectors whose boundary contains both vertex IDs.
 * Uses the reverse index to avoid scanning all sectors.
 * Returns array of { sid, area } sorted by area ascending.
 */
export function findSectorsContainingBothVertices(
  vid1: string,
  vid2: string,
  buildSectorLoopIds: (sid: string) => string[][],
  buildSectorPoly: (sid: string) => { x: number; y: number }[] | null,
  polyArea: (poly: { x: number; y: number }[]) => number,
): { sid: string; area: number }[] {
  // Collect candidate sectors from linedefs touching vid1
  const candidateSectors = new Set<string>();
  const lds1 = vertexToLinedefs.get(vid1);
  if (!lds1) return [];

  for (const ldId of lds1) {
    collectSectorsFromLinedef(ldId, candidateSectors);
  }

  // Filter to sectors that also contain vid2 on their boundary
  const results: { sid: string; area: number }[] = [];
  for (const sid of candidateSectors) {
    const loops = buildSectorLoopIds(sid);
    for (const loop of loops) {
      if (loop.includes(vid1) && loop.includes(vid2)) {
        const poly = buildSectorPoly(sid);
        if (poly) results.push({ sid, area: polyArea(poly) });
        break;
      }
    }
  }

  results.sort((a, b) => a.area - b.area);
  return results;
}

/**
 * Check if any sector's boundary contains both vertex IDs.
 * Fast check version - returns true as soon as one is found.
 */
export function anyBoundaryContainsBoth(
  vid1: string,
  vid2: string,
  buildSectorLoopIds: (sid: string) => string[][],
): boolean {
  const lds1 = vertexToLinedefs.get(vid1);
  if (!lds1) return false;

  const candidateSectors = new Set<string>();
  for (const ldId of lds1) {
    collectSectorsFromLinedef(ldId, candidateSectors);
  }

  for (const sid of candidateSectors) {
    const loops = buildSectorLoopIds(sid);
    for (const loop of loops) {
      if (loop.includes(vid1) && loop.includes(vid2)) return true;
    }
  }

  return false;
}

function collectSectorsFromLinedef(ldId: string, out: Set<string>): void {
  const ld = maps.linedefs.get(ldId);
  if (!ld) return;
  if (ld.frontSide) {
    const sd = maps.sidedefs.get(ld.frontSide);
    if (sd?.sector) out.add(sd.sector);
  }
  if (ld.backSide) {
    const sd = maps.sidedefs.get(ld.backSide);
    if (sd?.sector) out.add(sd.sector);
  }
}
