import { maps, zoom, setDrawPoints } from '../state/appState';
import { snap } from '../canvas/transforms';
import { nearestVertex, segmentsProperlyIntersect, polyArea, pointInPoly } from '../geometry/hitTest';
import { VERTEX_PICK_PX } from '../config/ux';
import { buildSectorLoopIds, pointInSector } from '../geometry/cycleFinder';
import { findSectorsContainingBothVertices, anyBoundaryContainsBoth, findExistingLinedef } from '../geometry/sectorQueries';
import { signedArea2 } from '../geometry/polygonMath';
import { createSectorFromPolygon, splitSector } from './mapActions';
import { showToast } from '../ui/toast';
import { recordDrawClick, recordDrawComplete } from '../testing/recorder';
import type { DrawVertex, Point } from '../types';

let drawChain: DrawVertex[] = [];

function syncDrawPoints(): void {
  setDrawPoints(drawChain.map(p => ({ x: p.x, y: p.y })));
}

export function drawReset(): void {
  drawChain = [];
  syncDrawPoints();
}

export function getDrawChain(): ReadonlyArray<DrawVertex> {
  return drawChain;
}

function expandChainWithBoundary(chain: DrawVertex[], sectorId: string): DrawVertex[] | null {
  const startVid = chain[0].existingId!;
  const endVid = chain[chain.length - 1].existingId!;

  const loops = buildSectorLoopIds(sectorId);
  let targetLoop: string[] | null = null;
  for (const loop of loops) {
    if (loop.includes(startVid) && loop.includes(endVid)) {
      targetLoop = loop;
      break;
    }
  }
  if (!targetLoop) return null;

  const si = targetLoop.indexOf(startVid);
  const ei = targetLoop.indexOf(endVid);
  const loopLen = targetLoop.length;

  const pathA: string[] = [];
  for (let i = (ei + 1) % loopLen; i !== si; i = (i + 1) % loopLen) {
    pathA.push(targetLoop[i]);
  }
  const pathB: string[] = [];
  for (let i = (ei - 1 + loopLen) % loopLen; i !== si; i = (i - 1 + loopLen) % loopLen) {
    pathB.push(targetLoop[i]);
  }

  let bestExpanded: DrawVertex[] | null = null;
  let bestArea = Infinity;

  for (const path of [pathA, pathB]) {
    const expanded: DrawVertex[] = [...chain];
    let valid = true;
    for (const vid of path) {
      const v = maps.vertices.get(vid);
      if (!v) { valid = false; break; }
      expanded.push({ x: v.x, y: v.y, existingId: vid });
    }
    if (!valid || expanded.length < 3) continue;
    const pts = expanded.map(p => ({ x: p.x, y: p.y }));

    // Check that existing linedefs in this expansion have the required side free.
    // Without this, non-convex boundaries can produce expansions where
    // createSectorFromPolygon skips occupied sides, creating degenerate sectors.
    const ccw = signedArea2(pts) < 0;
    let sidesOk = true;
    for (let i = 0; i < expanded.length; i++) {
      const va = expanded[i], vb = expanded[(i + 1) % expanded.length];
      if (!va.existingId || !vb.existingId) continue;
      const existing = findExistingLinedef(maps.linedefs, va.existingId, vb.existingId);
      if (!existing) continue;
      const ld = maps.linedefs.get(existing.ldId);
      if (!ld) continue;
      const useFront = existing.sameDirection !== ccw;
      if (useFront && ld.frontSide && !ld.backSide) { sidesOk = false; break; }
      if (!useFront && ld.backSide && !ld.frontSide) { sidesOk = false; break; }
    }
    if (!sidesOk) continue;

    const area = polyArea(pts);
    if (area < bestArea) {
      bestArea = area;
      bestExpanded = expanded;
    }
  }

  return bestExpanded;
}

function validateNewEdge(ax: number, ay: number, bx: number, by: number): boolean {
  for (const [, ld] of maps.linedefs) {
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) continue;
    if (segmentsProperlyIntersect(ax, ay, bx, by, v1.x, v1.y, v2.x, v2.y)) return false;
  }
  for (let i = 0; i < drawChain.length - 1; i++) {
    const p1 = drawChain[i], p2 = drawChain[i + 1];
    if (segmentsProperlyIntersect(ax, ay, bx, by, p1.x, p1.y, p2.x, p2.y)) return false;
  }
  return true;
}

async function completeSector(checkSplit: boolean = false): Promise<void> {
  if (checkSplit) {
    const first = drawChain[0];
    const last = drawChain[drawChain.length - 1];
    if (first.existingId && last.existingId && first.existingId !== last.existingId) {
      const candidates = findSectorsContainingBothVertices(
        first.existingId!, last.existingId!,
      );

      let splitSectorId: string | null = null;
      for (const cand of candidates) {
        if (drawChain.length > 2) {
          let anyNewInside = false;
          for (let i = 1; i < drawChain.length - 1; i++) {
            if (!drawChain[i].existingId && pointInSector(drawChain[i].x, drawChain[i].y, cand.sid)) {
              anyNewInside = true;
              break;
            }
          }
          if (!anyNewInside) continue;
        }

        // Verify the split line stays inside the target boundary loop.
        // Without this, non-convex sectors (like C-shapes) or hole loops
        // can be incorrectly selected for splitting.
        if (drawChain.length === 2) {
          const loops = buildSectorLoopIds(cand.sid);
          let valid = false;
          for (const loop of loops) {
            if (loop.includes(first.existingId!) && loop.includes(last.existingId!)) {
              const poly = loop.map(id => maps.vertices.get(id)).filter((v): v is Point => !!v);
              if (poly.length >= 3) {
                const mx = (first.x + last.x) / 2;
                const my = (first.y + last.y) / 2;
                // Accept if midpoint is inside the loop polygon (splitting
                // through the loop interior) OR inside the sector itself
                // (splitting the sector body across a hole boundary).
                valid = pointInPoly(mx, my, poly) || pointInSector(mx, my, cand.sid);
              }
              break;
            }
          }
          if (!valid) continue;
        }

        splitSectorId = cand.sid;
        break;
      }

      if (splitSectorId) {
        if (drawChain.length === 2) {
          const va = first.existingId!, vb = last.existingId!;
          let alreadyConnected = false;
          maps.linedefs.forEach(ld => {
            if ((ld.v1 === va && ld.v2 === vb) || (ld.v1 === vb && ld.v2 === va)) alreadyConnected = true;
          });
          if (alreadyConnected) {
            showToast('Vertices already connected by a linedef');
            drawReset();
            return;
          }
        }
        await splitSector(drawChain, splitSectorId);
        drawReset();
        return;
      }

      if (candidates.length > 0) {
        const expanded = expandChainWithBoundary(drawChain, candidates[0].sid);
        if (expanded) {
          await createSectorFromPolygon(expanded, true);
          drawReset();
          return;
        }
      }
    }
  }
  if (drawChain.length < 3) {
    showToast('Need at least 3 vertices to create a sector');
    drawReset();
    return;
  }
  await createSectorFromPolygon(drawChain);
  drawReset();
}

export async function drawClick(wx: number, wy: number): Promise<void> {
  const swx = snap(wx), swy = snap(wy);
  const existingVid = nearestVertex(wx, wy, VERTEX_PICK_PX / zoom);

  let clickX: number, clickY: number;
  let clickExisting: string | null = null;

  if (existingVid) {
    const v = maps.vertices.get(existingVid)!;
    clickX = v.x; clickY = v.y;
    clickExisting = existingVid;
  } else {
    clickX = swx; clickY = swy;
  }

  recordDrawClick(clickX, clickY);

  // First click
  if (drawChain.length === 0) {
    drawChain.push({ x: clickX, y: clickY, existingId: clickExisting });
    syncDrawPoints();
    return;
  }

  const first = drawChain[0];
  const last = drawChain[drawChain.length - 1];

  if (clickX === last.x && clickY === last.y) return;

  const CLOSE_THRESH = 24 / zoom;

  // Close at start
  if (drawChain.length >= 3) {
    const nearFirst = Math.hypot(clickX - first.x, clickY - first.y) < CLOSE_THRESH;
    const isFirstVert = clickExisting !== null && clickExisting === first.existingId;
    if (nearFirst || isFirstVert) {
      if (!validateNewEdge(last.x, last.y, first.x, first.y)) {
        showToast('Closing edge would intersect'); return;
      }
      await completeSector();
      return;
    }
  }

  // Close at different existing vert
  if (first.existingId && drawChain.length >= 1 && clickExisting &&
      !drawChain.some(p => p.existingId === clickExisting)) {
    if (!validateNewEdge(last.x, last.y, clickX, clickY)) {
      showToast('Edge would intersect'); return;
    }
    const isSplit = anyBoundaryContainsBoth(first.existingId!, clickExisting!);
    if (!isSplit && !validateNewEdge(clickX, clickY, first.x, first.y)) {
      showToast('Closing edge would intersect'); return;
    }
    drawChain.push({ x: clickX, y: clickY, existingId: clickExisting });
    await completeSector(true);
    return;
  }

  // Normal add
  if (!validateNewEdge(last.x, last.y, clickX, clickY)) {
    showToast('Edge would intersect'); return;
  }

  drawChain.push({ x: clickX, y: clickY, existingId: clickExisting });
  syncDrawPoints();
}

export async function drawComplete(): Promise<boolean> {
  if (drawChain.length < 3) return false;
  const first = drawChain[0], last = drawChain[drawChain.length - 1];
  if (!validateNewEdge(last.x, last.y, first.x, first.y)) {
    showToast('Closing edge would intersect');
    return false;
  }
  recordDrawComplete();
  await completeSector();
  return true;
}
