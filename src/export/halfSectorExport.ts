import { createCloneContext } from '../map/exportableMap';
import { fixSectors } from '../map/drawSession';
import { segmentIntersectionPoint } from '../geometry/hitTest';
import { signedArea2 } from '../geometry/polygonMath';
import type { HalfSector } from '../types';
import type { ExportableMap } from '../map/exportableMap';

type HsSegment = {
  v1: string; v2: string;
  ax: number; ay: number; bx: number; by: number;
  hsId: string;
};

/** For each HS linedef, which sidedef direction is the interior of the HS. */
type LdHsInfo = {
  hsId: string;
  /** true = frontSide (v1→v2 traversal) is inside the HS; false = backSide. */
  interiorSideFront: boolean;
};

/**
 * Merges half-sectors into a fresh clone of the normal map and returns it for
 * WAD export / 3D view. Returns null when there are no half-sectors to apply.
 */
export function mergeHalfSectors(halfSectors: Map<string, HalfSector>): ExportableMap | null {
  if (halfSectors.size === 0) return null;

  const clone = createCloneContext();

  // Pre-compute winding for each HS polygon:
  // signedArea2 > 0  →  interior is on the LEFT of each directed edge in polygon order
  //                 →  the FRONT sidedef (face traversed v1→v2) is interior.
  // signedArea2 < 0  →  interior is on the RIGHT  →  BACK sidedef is interior.
  const hsInteriorFront = new Map<string, boolean>();
  for (const [hsId, hs] of halfSectors) {
    hsInteriorFront.set(hsId, signedArea2(hs.points) > 0);
  }

  // ── Step 1: Create HS polygon edges in the clone ──────────────────────────

  const allSegments: HsSegment[] = [];

  for (const [hsId, hs] of halfSectors) {
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
        hsId,
      });
    }
  }

  if (allSegments.length === 0) return null;

  // ── Step 2: Split ceiling/floor HS segments at mutual intersections ───────

  const ceilSegs  = allSegments.filter(s => halfSectors.get(s.hsId)!.type === 'ceiling');
  const floorSegs = allSegments.filter(s => halfSectors.get(s.hsId)!.type === 'floor');

  /** Split each segment in `segs` at intersections with `against`,
   *  carrying the originating hsId through to each sub-segment. */
  function splitAtIntersections(segs: HsSegment[], against: HsSegment[]): { v1: string; v2: string; hsId: string }[] {
    const result: { v1: string; v2: string; hsId: string }[] = [];
    for (const seg of segs) {
      const splits: { t: number; vid: string }[] = [];
      for (const other of against) {
        const pt = segmentIntersectionPoint(seg.ax, seg.ay, seg.bx, seg.by,
                                            other.ax, other.ay, other.bx, other.by);
        if (!pt) continue;
        const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
        const t   = len > 0 ? Math.hypot(pt.x - seg.ax, pt.y - seg.ay) / len : 0;
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
        if (vid !== prevV) result.push({ v1: prevV, v2: vid, hsId: seg.hsId });
        prevV = vid;
      }
      if (prevV !== seg.v2) result.push({ v1: prevV, v2: seg.v2, hsId: seg.hsId });
    }
    return result;
  }

  const splitCeil  = splitAtIntersections(ceilSegs,  floorSegs);
  const splitFloor = splitAtIntersections(floorSegs, ceilSegs);

  // ── Step 3: Add linedefs for all HS segments ──────────────────────────────
  // Track ldId → HS info (which side is interior).

  const activeLines = new Set<string>();
  const ldToHsInfo = new Map<string, LdHsInfo>();

  for (const { v1, v2, hsId } of [...splitCeil, ...splitFloor]) {
    if (v1 === v2) continue;

    let existingLdId: string | null = null;
    let existingSameDir = true;
    for (const [ldId, ld] of clone.linedefs) {
      if (ld.v1 === v1 && ld.v2 === v2) { existingLdId = ldId; existingSameDir = true;  break; }
      if (ld.v1 === v2 && ld.v2 === v1) { existingLdId = ldId; existingSameDir = false; break; }
    }

    const baseInteriorFront = hsInteriorFront.get(hsId)!;

    if (existingLdId) {
      // Direction may be reversed relative to the HS polygon order.
      ldToHsInfo.set(existingLdId, {
        hsId,
        interiorSideFront: existingSameDir ? baseInteriorFront : !baseInteriorFront,
      });
      continue;
    }

    const ldId = clone.pushLinedef({ v1, v2, flags: 1, frontSide: null, backSide: null });
    activeLines.add(ldId);
    ldToHsInfo.set(ldId, { hsId, interiorSideFront: baseInteriorFront });
  }

  if (activeLines.size === 0) return clone;

  // ── Step 4: Run fixSectors to create sectors in HS-bounded regions ────────

  const existingSectorIds = new Set(clone.sectors.keys());
  fixSectors(activeLines, clone);

  // ── Step 5: Apply HS properties to newly-created sectors ──────────────────

  // Build sidedef → linedef reverse index once.
  const sdToLd = new Map<string, string>();
  for (const [ldId, ld] of clone.linedefs) {
    if (ld.frontSide) sdToLd.set(ld.frontSide, ldId);
    if (ld.backSide)  sdToLd.set(ld.backSide,  ldId);
  }

  function hsPolyArea(hs: HalfSector): number {
    const pts = hs.points;
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    return Math.abs(a) / 2;
  }

  for (const [sid] of clone.sectors) {
    if (existingSectorIds.has(sid)) continue;

    // A sector belongs to HS X only if its sidedef is on the INTERIOR side of
    // the HS X boundary linedef — not just any side.
    const candidateHsIds = new Set<string>();
    for (const [sdId, sd] of clone.sidedefs) {
      if (sd.sector !== sid) continue;
      const ldId = sdToLd.get(sdId);
      if (!ldId) continue;
      const info = ldToHsInfo.get(ldId);
      if (!info) continue;

      const ld = clone.linedefs.get(ldId)!;
      const isFront = ld.frontSide === sdId;
      if (isFront === info.interiorSideFront) {
        candidateHsIds.add(info.hsId);
      }
    }
    if (candidateHsIds.size === 0) continue;

    // Ceiling and floor HSes are independent — apply the smallest of each type.
    let bestCeilHs: HalfSector | null = null, bestCeilArea = Infinity;
    let bestFloorHs: HalfSector | null = null, bestFloorArea = Infinity;
    for (const hsId of candidateHsIds) {
      const hs = halfSectors.get(hsId);
      if (!hs) continue;
      const area = hsPolyArea(hs);
      if (hs.type === 'ceiling' && area < bestCeilArea) { bestCeilArea = area; bestCeilHs = hs; }
      if (hs.type === 'floor'   && area < bestFloorArea) { bestFloorArea = area; bestFloorHs = hs; }
    }

    const sec = clone.sectors.get(sid)!;
    if (bestCeilHs) {
      sec.ceiling = bestCeilHs.ceiling;
      if (bestCeilHs.ceilTex) sec.ceilTex = bestCeilHs.ceilTex;
      sec.light = bestCeilHs.light;
    }
    if (bestFloorHs) {
      sec.floor = bestFloorHs.floor;
      if (bestFloorHs.floorTex) sec.floorTex = bestFloorHs.floorTex;
      sec.light = bestFloorHs.light;
    }
  }

  return clone;
}
