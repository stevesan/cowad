import { maps } from './appState';

/** Reverse index: vertex ID → set of linedef IDs that use it. */
export const vertexToLinedefs = new Map<string, Set<string>>();

/** Reverse index: sector ID → set of sidedef IDs that reference it. */
export const sectorToSidedefs = new Map<string, Set<string>>();

/** Reverse index: sidedef ID → linedef ID that owns it. */
export const sidedefToLinedef = new Map<string, string>();

/** Derived lookup: get all linedef IDs bordering a sector. */
export function getLinedefsForSector(sid: string): Set<string> {
  const result = new Set<string>();
  const sdIds = sectorToSidedefs.get(sid);
  if (sdIds) {
    for (const sdId of sdIds) {
      const ldId = sidedefToLinedef.get(sdId);
      if (ldId) result.add(ldId);
    }
  }
  return result;
}

/** Rebuild all indices from scratch (e.g. on initial load). */
export function rebuildIndices(): void {
  vertexToLinedefs.clear();
  sectorToSidedefs.clear();
  sidedefToLinedef.clear();
  maps.linedefs.forEach((ld, id) => {
    addVertexIndex(id, ld.v1, ld.v2);
    addSidedefToLinedefIndex(id, ld.frontSide, ld.backSide);
  });
  maps.sidedefs.forEach((sd, id) => {
    addSectorToSidedefIndex(id, sd.sector);
  });
}

/** Call when a linedef is added. */
export function onLinedefAdded(id: string, v1: string, v2: string): void {
  addVertexIndex(id, v1, v2);
  const ld = maps.linedefs.get(id);
  if (ld) addSidedefToLinedefIndex(id, ld.frontSide, ld.backSide);
}

/** Call when a linedef is changed. */
export function onLinedefChanged(id: string, v1: string, v2: string, oldV1?: string, oldV2?: string): void {
  if (oldV1 && oldV1 !== v1) vertexToLinedefs.get(oldV1)?.delete(id);
  if (oldV2 && oldV2 !== v2) vertexToLinedefs.get(oldV2)?.delete(id);
  addVertexIndex(id, v1, v2);
  // Re-map sidedef→linedef in case frontSide/backSide changed
  removeSidedefToLinedefIndex(id);
  const ld = maps.linedefs.get(id);
  if (ld) addSidedefToLinedefIndex(id, ld.frontSide, ld.backSide);
}

/** Call when a linedef is removed. */
export function onLinedefRemoved(id: string, v1: string, v2: string): void {
  vertexToLinedefs.get(v1)?.delete(id);
  vertexToLinedefs.get(v2)?.delete(id);
  removeSidedefToLinedefIndex(id);
}

/** Call when a sidedef is added. */
export function onSidedefAdded(id: string, sector: string | null): void {
  addSectorToSidedefIndex(id, sector);
}

/** Call when a sidedef is changed. */
export function onSidedefChanged(id: string, sector: string | null, oldSector?: string | null): void {
  if (oldSector && oldSector !== sector) {
    sectorToSidedefs.get(oldSector)?.delete(id);
  }
  addSectorToSidedefIndex(id, sector);
}

/** Call when a sidedef is removed. */
export function onSidedefRemoved(id: string, sector: string | null): void {
  if (sector) sectorToSidedefs.get(sector)?.delete(id);
  sidedefToLinedef.delete(id);
}

// ── vertex ↔ linedef ──

function addVertexIndex(id: string, v1: string, v2: string): void {
  if (!vertexToLinedefs.has(v1)) vertexToLinedefs.set(v1, new Set());
  if (!vertexToLinedefs.has(v2)) vertexToLinedefs.set(v2, new Set());
  vertexToLinedefs.get(v1)!.add(id);
  vertexToLinedefs.get(v2)!.add(id);
}

// ── sidedef ↔ linedef ──

function addSidedefToLinedefIndex(ldId: string, frontSide?: string | null, backSide?: string | null): void {
  if (frontSide) sidedefToLinedef.set(frontSide, ldId);
  if (backSide) sidedefToLinedef.set(backSide, ldId);
}

function removeSidedefToLinedefIndex(ldId: string): void {
  for (const [sdId, ownerLd] of sidedefToLinedef) {
    if (ownerLd === ldId) sidedefToLinedef.delete(sdId);
  }
}

// ── sector ↔ sidedef ──

function addSectorToSidedefIndex(sdId: string, sector: string | null): void {
  if (!sector) return;
  if (!sectorToSidedefs.has(sector)) sectorToSidedefs.set(sector, new Set());
  sectorToSidedefs.get(sector)!.add(sdId);
}

/**
 * Find all sectors whose boundary contains both vertex IDs.
 * Returns array of { sid, area } sorted by area ascending.
 */
export function findSectorsContainingBothVertices(
  vid1: string,
  vid2: string,
  buildSectorLoopIds: (sid: string) => string[][],
  buildSectorPoly: (sid: string) => { x: number; y: number }[] | null,
  polyArea: (poly: { x: number; y: number }[]) => number,
): { sid: string; area: number }[] {
  const candidateSectors = new Set<string>();
  const lds1 = vertexToLinedefs.get(vid1);
  if (!lds1) return [];

  for (const ldId of lds1) {
    collectSectorsFromLinedef(ldId, candidateSectors);
  }

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

/**
 * BFS from fromVid to toVid along the linedef graph.
 * Returns intermediate vertex IDs (excluding both endpoints).
 * Prefers walking single-sided (exterior) edges first.
 */
export function findBoundaryPath(fromVid: string, toVid: string): string[] | null {
  for (const singleSidedOnly of [true, false]) {
    const parent = new Map<string, string | null>();
    parent.set(fromVid, null);
    const queue: string[] = [fromVid];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const lds = vertexToLinedefs.get(cur);
      if (!lds) continue;

      for (const ldId of lds) {
        const ld = maps.linedefs.get(ldId);
        if (!ld) continue;
        if (singleSidedOnly && ld.frontSide && ld.backSide) continue;
        const neighbor = ld.v1 === cur ? ld.v2 : ld.v1;
        if (parent.has(neighbor)) continue;
        parent.set(neighbor, cur);
        if (neighbor === toVid) {
          const path: string[] = [];
          let v = parent.get(toVid)!;
          while (v !== null && v !== fromVid) {
            path.push(v);
            v = parent.get(v)!;
          }
          path.reverse();
          return path;
        }
        queue.push(neighbor);
      }
    }
  }

  return null;
}
