import { mapRef } from '../config/firebase';
import { maps, zoom, setDrawPoints } from '../state/appState';
import { snap } from '../canvas/transforms';
import { nearestVertex, segmentsProperlyIntersect } from '../geometry/hitTest';
import { signedArea2 } from '../geometry/polygonMath';
import { VERTEX_PICK_PX } from '../config/ux';
import { anyBoundaryContainsBoth, findExistingLinedef } from '../geometry/sectorQueries';
import { beginAction, record, endAction } from '../history/undoRedo';
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

async function applyDrawChain(isLoop: boolean): Promise<void> {
  const n = drawChain.length;
  if (n < 2) return;

  beginAction();

  // Resolve vertex IDs: reuse existing or create new
  const vertexIds: string[] = [];
  for (const pt of drawChain) {
    if (pt.existingId) {
      vertexIds.push(pt.existingId);
    } else {
      const val = { x: pt.x, y: pt.y };
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      vertexIds.push(ref.key);
    }
  }

  // Create or find linedefs for each edge
  const edgeCount = isLoop ? n : n - 1;
  const activeLines: string[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const va = vertexIds[i];
    const vb = vertexIds[(i + 1) % n];
    const existing = findExistingLinedef(maps.linedefs, va, vb);
    if (existing) {
      activeLines.push(existing.ldId);
    } else {
      const ldVal = { v1: va, v2: vb, flags: 1 };
      const ref = mapRef('linedefs').push(ldVal);
      record(`map/linedefs/${ref.key}`, null, ldVal);
      activeLines.push(ref.key);
    }
  }

  // Build vertex adjacency from ALL linedefs, sorted by angle
  const vertexAdj = new Map<string, { angle: number, toVid: string, ldId: string }[]>();
  function addAdj(fromVid: string, toVid: string, ldId: string) {
    const f = maps.vertices.get(fromVid), t = maps.vertices.get(toVid);
    if (!f || !t) return;
    if (!vertexAdj.has(fromVid)) vertexAdj.set(fromVid, []);
    vertexAdj.get(fromVid)!.push({ angle: Math.atan2(t.y - f.y, t.x - f.x), toVid, ldId });
  }
  for (const [ldId, ld] of maps.linedefs) {
    addAdj(ld.v1, ld.v2, ldId);
    addAdj(ld.v2, ld.v1, ldId);
  }
  for (const edges of vertexAdj.values()) {
    edges.sort((a, b) => a.angle - b.angle);
  }

  // Next half-edge in face traversal: arriving at toVid from fromVid via ldId,
  // find the twin (toVid→fromVid) in toVid's adjacency, then step clockwise
  // (one index back in the ascending-angle-sorted list).
  function nextHE(fromVid: string, toVid: string, ldId: string): { fromVid: string, toVid: string, ldId: string } {
    const edges = vertexAdj.get(toVid)!;
    let twinIdx = 0;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i].toVid === fromVid && edges[i].ldId === ldId) { twinIdx = i; break; }
    }
    const next = edges[(twinIdx - 1 + edges.length) % edges.length];
    return { fromVid: toVid, toVid: next.toVid, ldId: next.ldId };
  }

  // Enumerate active-line half-edges
  const activeSet = new Set(activeLines);
  type HE = { fromVid: string, toVid: string, ldId: string };
  const allActiveHEs: HE[] = [];
  for (const ldId of activeLines) {
    const ld = maps.linedefs.get(ldId)!;
    allActiveHEs.push({ fromVid: ld.v1, toVid: ld.v2, ldId });
    allActiveHEs.push({ fromVid: ld.v2, toVid: ld.v1, ldId });
  }

  // Traverse faces starting from unvisited active HEs
  const heKey = (he: HE) => `${he.ldId}:${he.fromVid}`;
  const visited = new Set<string>();
  const faces: HE[][] = [];

  for (const startHE of allActiveHEs) {
    if (visited.has(heKey(startHE))) continue;

    const loop: HE[] = [];
    let cur = startHE;
    for (;;) {
      loop.push(cur);
      if (activeSet.has(cur.ldId)) visited.add(heKey(cur));
      cur = nextHE(cur.fromVid, cur.toVid, cur.ldId);
      if (cur.fromVid === startHE.fromVid && cur.toVid === startHE.toVid && cur.ldId === startHE.ldId) break;
      if (loop.length > maps.linedefs.size * 2) break; // safety
    }

    // Interior faces have CCW winding (signedArea2 < 0)
    const poly: Point[] = loop.map(he => maps.vertices.get(he.fromVid)!);
    if (signedArea2(poly) < 0) {
      faces.push(loop);
    }
  }

  // For each enclosed face, create sidedefs for HEs that don't have one
  for (const face of faces) {
    for (const he of face) {
      const ld = maps.linedefs.get(he.ldId)!;
      const isFront = (he.fromVid === ld.v1);
      const existingSideId = isFront ? ld.frontSide : ld.backSide;

      if (!existingSideId) {
        const sdVal = { sector: null, xoff: 0, yoff: 0, upper: '-', mid: '-', lower: '-' };
        const sdRef = mapRef('sidedefs').push(sdVal);
        record(`map/sidedefs/${sdRef.key}`, null, sdVal);

        const ldBefore = { ...ld };
        if (isFront) {
          const ldAfter = { ...ldBefore, frontSide: sdRef.key };
          record(`map/linedefs/${he.ldId}`, ldBefore, ldAfter);
          mapRef('linedefs').child(he.ldId).update({ frontSide: sdRef.key });
        } else {
          const ldAfter = { ...ldBefore, backSide: sdRef.key };
          record(`map/linedefs/${he.ldId}`, ldBefore, ldAfter);
          mapRef('linedefs').child(he.ldId).update({ backSide: sdRef.key });
        }
      }
    }
  }

  endAction();
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
      await applyDrawChain(true);
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
    await applyDrawChain(false);
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
  await applyDrawChain(true);
  return true;
}
