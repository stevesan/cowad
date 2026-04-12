import { createCloneContext } from '../map/exportableMap';
import { fixSectors } from '../map/drawSession';
import { segmentIntersectionPoint, pointInPoly } from '../geometry/hitTest';
import type { HalfSector, Point } from '../types';
import type { ExportableMap } from '../map/exportableMap';

type HsSegment = {
  v1: string; v2: string;
  ax: number; ay: number; bx: number; by: number;
  hsType: 'ceiling' | 'floor';
};

/** Find a representative centroid for the given sector in a clone context. */
function getSectorCentroid(sectorId: string, clone: ExportableMap): Point | null {
  // Build a quick sidedef→linedef reverse lookup
  const sdToLd = new Map<string, string>();
  for (const [ldId, ld] of clone.linedefs) {
    if (ld.frontSide) sdToLd.set(ld.frontSide, ldId);
    if (ld.backSide)  sdToLd.set(ld.backSide,  ldId);
  }

  let sumX = 0, sumY = 0, count = 0;
  for (const [sdId, sd] of clone.sidedefs) {
    if (sd.sector !== sectorId) continue;
    const ldId = sdToLd.get(sdId);
    if (!ldId) continue;
    const ld = clone.linedefs.get(ldId)!;
    const v1 = clone.vertices.get(ld.v1);
    const v2 = clone.vertices.get(ld.v2);
    if (v1) { sumX += v1.x; sumY += v1.y; count++; }
    if (v2) { sumX += v2.x; sumY += v2.y; count++; }
  }
  if (!count) return null;
  return { x: sumX / count, y: sumY / count };
}

/**
 * Merges half-sectors into a fresh clone of the normal map and returns it for
 * WAD export. Returns null when there are no half-sectors to apply.
 */
export function mergeHalfSectors(halfSectors: Map<string, HalfSector>): ExportableMap | null {
  if (halfSectors.size === 0) return null;

  const clone = createCloneContext();

  // ── Step 1: Create HS polygon edges in the clone ──────────────────────────

  const allSegments: HsSegment[] = [];

  for (const [, hs] of halfSectors) {
    const pts = hs.points;
    if (pts.length < 3) continue;

    // Reuse coincident vertices already in the clone, or create new ones.
    const vIds: string[] = [];
    for (const pt of pts) {
      let vid: string | null = null;
      for (const [id, v] of clone.vertices) {
        if (v.x === pt.x && v.y === pt.y) { vid = id; break; }
      }
      if (!vid) vid = clone.pushVertex({ x: pt.x, y: pt.y });
      vIds.push(vid);
    }

    for (let i = 0; i < vIds.length; i++) {
      const j = (i + 1) % vIds.length;
      allSegments.push({
        v1: vIds[i], v2: vIds[j],
        ax: pts[i].x, ay: pts[i].y,
        bx: pts[j].x, by: pts[j].y,
        hsType: hs.type,
      });
    }
  }

  if (allSegments.length === 0) return null;

  // ── Step 2: Split ceiling/floor HS segments at mutual intersections ───────

  const ceilSegs  = allSegments.filter(s => s.hsType === 'ceiling');
  const floorSegs = allSegments.filter(s => s.hsType === 'floor');

  /** Split each segment in `segs` at interior intersections with `against`. */
  function splitAtIntersections(segs: HsSegment[], against: HsSegment[]): { v1: string; v2: string }[] {
    const result: { v1: string; v2: string }[] = [];
    for (const seg of segs) {
      const splits: { t: number; vid: string }[] = [];
      for (const other of against) {
        const pt = segmentIntersectionPoint(seg.ax, seg.ay, seg.bx, seg.by,
                                            other.ax, other.ay, other.bx, other.by);
        if (!pt) continue;
        const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
        const t   = len > 0 ? Math.hypot(pt.x - seg.ax, pt.y - seg.ay) / len : 0;
        // Find or create a vertex at the intersection
        let vid: string | null = null;
        for (const [id, v] of clone.vertices) {
          if (Math.abs(v.x - pt.x) < 0.01 && Math.abs(v.y - pt.y) < 0.01) { vid = id; break; }
        }
        if (!vid) vid = clone.pushVertex(pt);
        splits.push({ t, vid });
      }
      splits.sort((a, b) => a.t - b.t);

      let prevV = seg.v1;
      for (const { vid } of splits) {
        if (vid !== prevV) result.push({ v1: prevV, v2: vid });
        prevV = vid;
      }
      if (prevV !== seg.v2) result.push({ v1: prevV, v2: seg.v2 });
    }
    return result;
  }

  const splitCeil  = splitAtIntersections(ceilSegs,  floorSegs);
  const splitFloor = splitAtIntersections(floorSegs, ceilSegs);

  // ── Step 3: Add linedefs for all HS segments ──────────────────────────────

  const activeLines = new Set<string>();
  for (const { v1, v2 } of [...splitCeil, ...splitFloor]) {
    if (v1 === v2) continue;
    // Skip if this edge already exists in the clone.
    let exists = false;
    for (const [, ld] of clone.linedefs) {
      if ((ld.v1 === v1 && ld.v2 === v2) || (ld.v1 === v2 && ld.v2 === v1)) { exists = true; break; }
    }
    if (exists) continue;
    const ldId = clone.pushLinedef({ v1, v2, flags: 1, frontSide: null, backSide: null });
    activeLines.add(ldId);
  }

  if (activeLines.size === 0) return clone;

  // ── Step 4: Run fixSectors to create sectors in HS-bounded regions ────────

  const existingSectorIds = new Set(clone.sectors.keys());
  fixSectors(activeLines, clone);

  // ── Step 5: Apply HS properties to newly-created sectors ──────────────────

  function hsPolyArea(pts: Point[]): number {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    return Math.abs(a) / 2;
  }

  for (const [sid] of clone.sectors) {
    if (existingSectorIds.has(sid)) continue;
    const centroid = getSectorCentroid(sid, clone);
    if (!centroid) continue;

    // Find the smallest HS whose polygon contains this centroid.
    let bestHs: HalfSector | null = null;
    let bestArea = Infinity;
    for (const [, hs] of halfSectors) {
      if (!pointInPoly(centroid.x, centroid.y, hs.points)) continue;
      const area = hsPolyArea(hs.points);
      if (area < bestArea) { bestArea = area; bestHs = hs; }
    }
    if (!bestHs) continue;

    // Apply the HS properties, overriding what fixSectors put there.
    const sec = clone.sectors.get(sid)!;
    if (bestHs.type === 'ceiling') {
      if (bestHs.ceiling != null) sec.ceiling = bestHs.ceiling;
      if (bestHs.ceilTex)         sec.ceilTex = bestHs.ceilTex;
    } else {
      if (bestHs.floor != null) sec.floor = bestHs.floor;
      if (bestHs.floorTex)      sec.floorTex = bestHs.floorTex;
    }
    if (bestHs.light != null) sec.light = bestHs.light;
  }

  return clone;
}
