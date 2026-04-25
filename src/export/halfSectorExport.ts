import { createCloneContext } from '../map/exportableMap';
import { fixSectors } from '../map/drawSession';
import { segmentSplitPoint, pointInPoly } from '../geometry/hitTest';
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

  // ── Pre-compute HS containment ────────────────────────────────────────────
  // hsContainedBy[A] = set of HS IDs whose polygon contains A's first vertex.
  // Valid because if A and B don't cross, one is either fully inside the other
  // or fully outside — a single point test distinguishes them.
  const hsContainedBy = new Map<string, Set<string>>();
  for (const [hsId] of halfSectors) hsContainedBy.set(hsId, new Set());
  for (const [hsIdA, hsA] of halfSectors) {
    for (const [hsIdB, hsB] of halfSectors) {
      if (hsIdA === hsIdB) continue;
      if (pointInPoly(hsA.points[0].x, hsA.points[0].y, hsB.points)) {
        hsContainedBy.get(hsIdA)!.add(hsIdB);
      }
    }
  }

  // Containment depth: 0 = outermost, 1 = inside a level-0 HS, etc.
  // Used to run fixSectors level-by-level so inner HS linedefs are always
  // processed after the outer HS's sector already exists in the clone.
  const hsLevel = new Map<string, number>();
  for (const [hsId] of halfSectors) hsLevel.set(hsId, 0);
  let levelChanged = true;
  while (levelChanged) {
    levelChanged = false;
    for (const [hsId, containers] of hsContainedBy) {
      let maxContainerLevel = -1;
      for (const cid of containers) maxContainerLevel = Math.max(maxContainerLevel, hsLevel.get(cid) ?? 0);
      const newLevel = maxContainerLevel + 1;
      if (newLevel > (hsLevel.get(hsId) ?? 0)) {
        hsLevel.set(hsId, newLevel);
        levelChanged = true;
      }
    }
  }

  // Pre-compute polygon winding for each HS:
  // signedArea2 > 0 → interior is on the LEFT of each directed edge
  //               → the FRONT sidedef (face traversed v1→v2) is interior.
  // signedArea2 < 0 → interior is on the RIGHT → BACK sidedef is interior.
  const hsInteriorFront = new Map<string, boolean>();
  for (const [hsId, hs] of halfSectors) {
    hsInteriorFront.set(hsId, signedArea2(hs.points) > 0);
  }

  // ── Step 1: Create HS polygon edges in the clone ──────────────────────────

  const allSegments: HsSegment[] = [];

  for (const [hsId, hs] of halfSectors) {
    const pts = hs.points;
    if (pts.length < 3) continue;

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

  // ── Step 2: Split all HS segments at mutual intersections ─────────────────
  // Split every segment against every segment from a DIFFERENT HS.
  // This handles crossing (ceil×floor, ceil×ceil, floor×floor) and T-junctions.

  function splitAtIntersections(segs: HsSegment[], against: HsSegment[]): { v1: string; v2: string; hsId: string }[] {
    const result: { v1: string; v2: string; hsId: string }[] = [];
    for (const seg of segs) {
      const splits: { t: number; vid: string }[] = [];
      for (const other of against) {
        if (other.hsId === seg.hsId) continue; // never split against own polygon
        const pt = segmentSplitPoint(seg.ax, seg.ay, seg.bx, seg.by,
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

  const splitAll = splitAtIntersections(allSegments, allSegments);

  // ── Step 3: Add linedefs, build ldToHsInfo and per-level active-line sets ──

  const ldToHsInfo = new Map<string, LdHsInfo>();
  const activeLinesPerLevel = new Map<number, Set<string>>();

  for (const { v1, v2, hsId } of splitAll) {
    if (v1 === v2) continue;

    let existingLdId: string | null = null;
    let existingSameDir = true;
    for (const [ldId, ld] of clone.linedefs) {
      if (ld.v1 === v1 && ld.v2 === v2) { existingLdId = ldId; existingSameDir = true;  break; }
      if (ld.v1 === v2 && ld.v2 === v1) { existingLdId = ldId; existingSameDir = false; break; }
    }

    const baseInteriorFront = hsInteriorFront.get(hsId)!;

    if (existingLdId) {
      ldToHsInfo.set(existingLdId, {
        hsId,
        interiorSideFront: existingSameDir ? baseInteriorFront : !baseInteriorFront,
      });
      continue;
    }

    const ldId = clone.pushLinedef({ v1, v2, flags: 1, frontSide: null, backSide: null });
    ldToHsInfo.set(ldId, { hsId, interiorSideFront: baseInteriorFront });

    const level = hsLevel.get(hsId) ?? 0;
    if (!activeLinesPerLevel.has(level)) activeLinesPerLevel.set(level, new Set());
    activeLinesPerLevel.get(level)!.add(ldId);
  }

  if (activeLinesPerLevel.size === 0) return clone;

  // ── Step 4: Run fixSectors level-by-level (outermost first) ───────────────
  // Processing outermost HSes first ensures their sectors exist before inner
  // HSes run fixSectors — so inner HS linedefs correctly subdivide the outer
  // sector rather than creating disconnected overlapping sectors.

  const existingSectorIds = new Set(clone.sectors.keys());
  const maxLevel = Math.max(...activeLinesPerLevel.keys());
  for (let lv = 0; lv <= maxLevel; lv++) {
    const lines = activeLinesPerLevel.get(lv);
    if (lines && lines.size > 0) fixSectors(lines, clone);
  }

  // ── Step 5: Apply HS properties to newly-created sectors ──────────────────

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

    // Expand candidates transitively: if sector is inside HS A and A ⊂ B,
    // then the sector is also inside B.
    const queue = [...candidateHsIds];
    while (queue.length) {
      const hsId = queue.shift()!;
      for (const parentId of hsContainedBy.get(hsId) ?? []) {
        if (!candidateHsIds.has(parentId)) {
          candidateHsIds.add(parentId);
          queue.push(parentId);
        }
      }
    }

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
