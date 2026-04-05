import { mapRef } from '../config/firebase';
import { maps, zoom, setDrawPoints } from '../state/appState';
import { snap } from '../canvas/transforms';
import { nearestVertex, segmentsProperlyIntersect, pointInPoly } from '../geometry/hitTest';
import { signedArea2 } from '../geometry/polygonMath';
import { VERTEX_PICK_PX } from '../config/ux';
import { anyBoundaryContainsBoth, findExistingLinedef } from '../geometry/sectorQueries';
import { beginAction, record, endAction } from '../history/undoRedo';
import { showToast } from '../ui/toast';
import { recordDrawClick, recordDrawComplete } from '../testing/recorder';
import type { DrawVertex } from '../types';

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

function cloneSector(srcId: string): string {
  const src = maps.sectors.get(srcId);
  const secVal = src
    ? { floor: src.floor, ceiling: src.ceiling, light: src.light,
        ...(src.special != null ? { special: src.special } : {}),
        ...(src.tag != null ? { tag: src.tag } : {}),
        ...(src.floorTex != null ? { floorTex: src.floorTex } : {}),
        ...(src.ceilTex != null ? { ceilTex: src.ceilTex } : {}) }
    : { floor: 0, ceiling: 128, light: 160, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' };
  const secRef = mapRef('sectors').push(secVal);
  record(`map/sectors/${secRef.key}`, null, secVal);
  return secRef.key;
}

type HE = { fromVid: string; toVid: string; ldId: string };

export type LoopNode = { loop: HE[]; area2: number; children: LoopNode[] };

export function computeLoopHierarchy(faces: { loop: HE[]; area2: number }[]): LoopNode[] {
  const nodes: LoopNode[] = faces.map(f => ({ loop: f.loop, area2: f.area2, children: [] }));

  // Sort by absolute area descending (largest first).
  nodes.sort((a, b) => Math.abs(b.area2) - Math.abs(a.area2));

  // Check if loop U geometrically contains loop V.
  function contains(u: LoopNode, v: LoopNode): boolean {
    // Ignore loops of the same sign. U may contain V, but it will never
    // be *immediate*. It will be via some other loop with the opposite sign.
    if(u.area2 < 0 === v.area2 < 0) return false;

    // If two loops share edges, one is outward and one is inward.
    // The outward (hole) loop contains the inward (boundary) loop.
    const uEdges = new Set(u.loop.map(he => he.ldId));
    for (const he of v.loop) {
      if (uEdges.has(he.ldId)) {
        return u.area2 < 0 && v.area2 > 0;
      }
    }
    // No shared edges: point-in-polygon test.
    const testPt = maps.vertices.get(v.loop[0].fromVid)!;
    const uPoly = u.loop.map(he => maps.vertices.get(he.fromVid)!);
    return pointInPoly(testPt.x, testPt.y, uPoly);
  }

  // For each node, find its immediate parent: the smallest loop that contains it.
  // Since nodes are sorted largest-first, iterating j from i-1 down to 0
  // checks from smallest candidate to largest — the first hit is the tightest container.
  const roots: LoopNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const v = nodes[i];
    let parent: LoopNode | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (contains(nodes[j], v)) {
        parent = nodes[j];
        break;
      }
    }
    if (parent) {
      parent.children.push(v);
    } else {
      roots.push(v);
    }
  }

  return roots;
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

  fixSectors(new Set(activeLines));
  
  endAction();
  drawReset();
}

/** Apply an externally-built draw chain (used by bridgeLinedefs etc.). */
export async function applyExternalDrawChain(chain: DrawVertex[], isLoop: boolean): Promise<void> {
  drawChain = chain;
  await applyDrawChain(isLoop);
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

export function fixSectors(newLds: Set<string>): void {
  // Build vertex adjacency from ALL linedefs, sorted by angle.
  const vertexAdj = new Map<string, { angle: number; toVid: string; ldId: string }[]>();
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

  // Next half-edge in planar face traversal.
  function nextHE(fromVid: string, toVid: string, ldId: string): HE {
    const edges = vertexAdj.get(toVid)!;
    let twinIdx = -1;
    for (let i = 0; i < edges.length; i++) {
      if (edges[i].toVid === fromVid && edges[i].ldId === ldId) { twinIdx = i; break; }
    }
    if (twinIdx === -1) throw new Error('Could not find twin');
    const next = edges[(twinIdx + 1) % edges.length];
    return { fromVid: toVid, toVid: next.toVid, ldId: next.ldId };
  }

  const heKey = (he: HE) => `${he.ldId}:${he.fromVid}`;

  function traceFace(startHE: HE): HE[] {
    const loop: HE[] = [];
    let cur = startHE;
    for (;;) {
      loop.push(cur);
      cur = nextHE(cur.fromVid, cur.toVid, cur.ldId);
      if (cur.fromVid === startHE.fromVid && cur.toVid === startHE.toVid && cur.ldId === startHE.ldId) break;
      if (loop.length > maps.linedefs.size * 2) break; // safety
    }
    return loop;
  }

  // ---- PFT from new linedefs ----
  const visited = new Set<string>();
  const newFaces: { loop: HE[]; area2: number }[] = [];
  for (const ldId of newLds) {
    const ld = maps.linedefs.get(ldId)!;
    for (const start of [
      { fromVid: ld.v1, toVid: ld.v2, ldId } as HE,
      { fromVid: ld.v2, toVid: ld.v1, ldId } as HE
    ]) {
      if (visited.has(heKey(start))) continue;
      const loop = traceFace(start);
      for (const he of loop) {
        if (newLds.has(he.ldId)) visited.add(heKey(he));
      }
      const poly = loop.map(he => maps.vertices.get(he.fromVid)!);
      newFaces.push({ loop, area2: signedArea2(poly) });
    }
  }

  // ---- Helpers ----
  function getExistingSd(he: HE): string | null {
    const ld = maps.linedefs.get(he.ldId)!;
    const isFront = (he.fromVid === ld.v1);
    return (isFront ? ld.frontSide : ld.backSide) ?? null;
  }

  function ensureSidedef(he: HE): string {
    const existing = getExistingSd(he);
    if (existing) return existing;

    const ld = maps.linedefs.get(he.ldId)!;
    const isFront = (he.fromVid === ld.v1);
    const oppSdId = isFront ? ld.backSide : ld.frontSide;
    const becomesTwoSided = !!oppSdId;

    const sdVal = {
      sector: null, xoff: 0, yoff: 0,
      upper: becomesTwoSided ? 'STARTAN2' : '-',
      mid: becomesTwoSided ? '-' : 'STARTAN2',
      lower: becomesTwoSided ? 'STARTAN2' : '-',
    };
    const sdRef = mapRef('sidedefs').push(sdVal);
    record(`map/sidedefs/${sdRef.key}`, null, sdVal);

    const ldBefore = { ...ld };
    const field = isFront ? 'frontSide' : 'backSide';
    const ldUpdates: Record<string, any> = { [field]: sdRef.key };

    if (becomesTwoSided) {
      // Set two-sided flag, clear impassable
      ldUpdates.flags = (ldBefore.flags | 4) & ~1;

      // Update opposite sidedef: ensure upper/lower, clear mid
      const oppSd = maps.sidedefs.get(oppSdId!);
      if (oppSd) {
        const oppUpd: Record<string, string> = {};
        if (!oppSd.upper || oppSd.upper === '-') oppUpd.upper = 'STARTAN2';
        if (!oppSd.lower || oppSd.lower === '-') oppUpd.lower = 'STARTAN2';
        if (oppSd.mid && oppSd.mid !== '-') oppUpd.mid = '-';
        if (Object.keys(oppUpd).length) {
          record(`map/sidedefs/${oppSdId}`, { ...oppSd }, { ...oppSd, ...oppUpd });
          mapRef('sidedefs').child(oppSdId!).update(oppUpd);
        }
      }
    }

    record(`map/linedefs/${he.ldId}`, ldBefore, { ...ldBefore, ...ldUpdates });
    mapRef('linedefs').child(he.ldId).update(ldUpdates);
    return sdRef.key;
  }

  function assignSdToSector(sdId: string, sectorId: string): void {
    const sd = maps.sidedefs.get(sdId)!;
    if (sd.sector !== sectorId) {
      const sdBefore = { ...sd };
      record(`map/sidedefs/${sdId}`, sdBefore, { ...sd, sector: sectorId });
      mapRef('sidedefs').child(sdId).update({ sector: sectorId });
    }
  }

  // ---- Full PFT from ALL linedefs + hierarchy (needed before the main loop) ----
  const allVisited = new Set<string>();
  const allFaces: { loop: HE[]; area2: number }[] = [];
  for (const [ldId, ld] of maps.linedefs) {
    for (const start of [
      { fromVid: ld.v1, toVid: ld.v2, ldId } as HE,
      { fromVid: ld.v2, toVid: ld.v1, ldId } as HE
    ]) {
      if (allVisited.has(heKey(start))) continue;
      const loop = traceFace(start);
      for (const he of loop) allVisited.add(heKey(he));
      const poly = loop.map(he => maps.vertices.get(he.fromVid)!);
      allFaces.push({ loop, area2: signedArea2(poly) });
    }
  }

  const hierarchy = computeLoopHierarchy(allFaces);

  function faceKey(loop: HE[]): string {
    return loop.map(heKey).sort().join('|');
  }
  const nodeByKey = new Map<string, LoopNode>();
  const parentOf = new Map<LoopNode, LoopNode | null>();
  function indexHierarchy(nodes: LoopNode[], parent: LoopNode | null) {
    for (const n of nodes) {
      nodeByKey.set(faceKey(n.loop), n);
      parentOf.set(n, parent);
      indexHierarchy(n.children, n);
    }
  }
  indexHierarchy(hierarchy, null);

  // ---- Process each new face ----
  const usedSectors = new Set<string>();
  const newFaceKeys = new Set(newFaces.map(f => faceKey(f.loop)));
  const processed: { face: { loop: HE[]; area2: number }; sectorId: string; isNewOrCloned: boolean }[] = [];

  for (const face of newFaces) {
    const isInward = face.area2 > 0;

    // Check existing sidedefs for a sector (without creating new ones)
    let sectorU: string | null = null;
    for (const he of face.loop) {
      const sdId = getExistingSd(he);
      if (sdId) {
        const sd = maps.sidedefs.get(sdId);
        if (sd?.sector) { sectorU = sd.sector; break; }
      }
    }

    let assignId: string;
    let isNewOrCloned = false;

    if (sectorU) {
      if (!usedSectors.has(sectorU)) {
        assignId = sectorU;
      } else {
        assignId = cloneSector(sectorU);
        isNewOrCloned = true;
      }
    } else if (isInward) {
      // All SDs clear: look on opposite sides for adjacent sector
      let adjSector: string | null = null;
      for (const he of face.loop) {
        const ld = maps.linedefs.get(he.ldId)!;
        const isFront = (he.fromVid === ld.v1);
        const oppSdId = isFront ? ld.backSide : ld.frontSide;
        if (oppSdId) {
          const oppSd = maps.sidedefs.get(oppSdId);
          if (oppSd?.sector) { adjSector = oppSd.sector; break; }
        }
      }
      if (adjSector) {
        assignId = cloneSector(adjSector);
      } else {
        const secVal = { floor: 0, ceiling: 128, light: 160, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' };
        const secRef = mapRef('sectors').push(secVal);
        record(`map/sectors/${secRef.key}`, null, secVal);
        assignId = secRef.key;
      }
      isNewOrCloned = true;
    } else {
      // Outward, all SDs clear: find containing sector via hierarchy parent
      const node = nodeByKey.get(faceKey(face.loop));
      if (!node) continue;
      const parent = parentOf.get(node);
      if (!parent) continue;
      // Find sector from parent's existing sidedefs
      let parentSector: string | null = null;
      for (const he of parent.loop) {
        const sdId = getExistingSd(he);
        if (sdId) {
          const sd = maps.sidedefs.get(sdId);
          if (sd?.sector) { parentSector = sd.sector; break; }
        }
      }
      if (!parentSector) continue;
      if (!usedSectors.has(parentSector)) {
        assignId = parentSector;
      } else {
        assignId = cloneSector(parentSector);
        isNewOrCloned = true;
      }
    }

    // Create sidedefs only now that we know the sector
    const sdIds = face.loop.map(ensureSidedef);
    usedSectors.add(assignId);
    for (const sdId of sdIds) assignSdToSector(sdId, assignId);
    processed.push({ face, sectorId: assignId, isNewOrCloned });
  }

  // ---- For new/cloned sectors, find related existing loops via hierarchy ----
  let qi = 0;
  while (qi < processed.length) {
    const { face, sectorId, isNewOrCloned } = processed[qi++];
    if (!isNewOrCloned) continue;

    const node = nodeByKey.get(faceKey(face.loop));
    if (!node) continue;

    if (face.area2 > 0) {
      // Inward: find existing loops immediately contained by this boundary
      for (const child of node.children) {
        if (newFaceKeys.has(faceKey(child.loop))) continue;
        const childSdIds = child.loop.map(ensureSidedef);
        for (const sdId of childSdIds) assignSdToSector(sdId, sectorId);
      }
    } else {
      // Outward: find existing loop that immediately contains this hole
      const parent = parentOf.get(node);
      if (parent && !newFaceKeys.has(faceKey(parent.loop))) {
        let parentChanged = false;
        const parentSdIds = parent.loop.map(ensureSidedef);
        for (const sdId of parentSdIds) {
          const sd = maps.sidedefs.get(sdId);
          if (!sd || sd.sector !== sectorId) parentChanged = true;
          assignSdToSector(sdId, sectorId);
        }
        // If the parent's sidedefs changed sector, its other children (existing
        // hole loops) also need updating — enqueue as inward so the branch above
        // handles them on a subsequent iteration.
        if (parentChanged) {
          processed.push({ face: { loop: parent.loop, area2: parent.area2 }, sectorId, isNewOrCloned: true });
        }
      }
    }
  }
}
