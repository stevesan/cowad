import {
  maps, tool, selected, hovered, pan, zoom, isPanning, panStart,
  spaceDown, dragState, mouseWorld, multiSelected, boxSelectStart, activeSide,
  setSelected, setHovered, setZoom, setIsPanning, setPanStart,
  setSpaceDown, setDragState, setMouseWorld, setTool, setDrawPoints,
  setMultiSelected, setBoxSelectStart, setActiveSide,
} from '../state/appState';
import { mapRef } from '../config/firebase';
import { s2w, snap } from '../canvas/transforms';
import { nearestVertex, nearestLinedef, nearestThing, pointInPoly, polyArea, segmentsProperlyIntersect } from '../geometry/hitTest';
import { buildSectorPoly, buildSectorLoopIds } from '../geometry/cycleFinder';
import { placeThing, deleteSelected, deleteMultiSelected, createSectorFromPolygon, splitSector, splitLinedefAtPoint, mergeVertices } from '../map/mapActions';
import { draw } from '../canvas/renderer';
import { renderPanel } from './propertiesPanel';
import { beginAction, record, endAction, undo, redo } from '../history/undoRedo';
import { showToast } from './toast';
import { toggle3D, is3DActive } from '../3d/view3d';
import { launchWAD } from '../export/wadExport';
import type { ToolType, Selection, DrawVertex } from '../types';

function select(type: Selection['type'], id: string): void { setSelected({ type, id }); renderPanel(); }

function linedefSide(lid: string, wx: number, wy: number): 'front' | 'back' | null {
  const ld = maps.linedefs.get(lid);
  if (!ld) return null;
  const v1 = maps.vertices.get(ld.v1);
  const v2 = maps.vertices.get(ld.v2);
  if (!v1 || !v2) return null;
  // Cross product: positive = left of v1→v2 = back side, negative = right = front side
  const cross = (v2.x - v1.x) * (wy - v1.y) - (v2.y - v1.y) * (wx - v1.x);
  return cross < 0 ? 'front' : 'back';
}

let dragOrigin: Record<string, any> | null = null;
let dragOffset = { x: 0, y: 0 };

// Multi-drag state
let multiDragOrigins: Map<string, { x: number; y: number }> | null = null;
let multiDragAnchorId: string | null = null;
let boxSelectAdditive = false;
let lastClientX = 0, lastClientY = 0;

// ── Draw tool state ──
let drawChain: DrawVertex[] = [];

function syncDrawPoints(): void {
  setDrawPoints(drawChain.map(p => ({ x: p.x, y: p.y })));
}

function resetDraw(): void {
  drawChain = [];
  syncDrawPoints();
}

/** When drawing a new sector adjacent to an existing one, expand the chain to include
 *  the boundary vertices between the two endpoints so existing linedefs get reused. */
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

  // Two boundary paths from endVid back to startVid (excluding both endpoints)
  const pathA: string[] = [];
  for (let i = (ei + 1) % loopLen; i !== si; i = (i + 1) % loopLen) {
    pathA.push(targetLoop[i]);
  }
  const pathB: string[] = [];
  for (let i = (ei - 1 + loopLen) % loopLen; i !== si; i = (i - 1 + loopLen) % loopLen) {
    pathB.push(targetLoop[i]);
  }

  // Try both paths, pick the one producing the smaller polygon
  // (the new adjacent sector is always smaller than the complement)
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
    const area = polyArea(pts);
    if (area < bestArea) {
      bestArea = area;
      bestExpanded = expanded;
    }
  }

  return bestExpanded;
}

function validateNewEdge(ax: number, ay: number, bx: number, by: number): boolean {
  // Check against existing linedefs
  for (const [, ld] of maps.linedefs) {
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) continue;
    if (segmentsProperlyIntersect(ax, ay, bx, by, v1.x, v1.y, v2.x, v2.y)) return false;
  }
  // Check against chain edges
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
      // Collect all sectors whose boundary loops contain both endpoints
      const candidates: { sid: string; area: number }[] = [];
      maps.sectors.forEach((_, sid) => {
        const loops = buildSectorLoopIds(sid);
        for (const loop of loops) {
          if (loop.includes(first.existingId!) && loop.includes(last.existingId!)) {
            const poly = buildSectorPoly(sid);
            if (poly) candidates.push({ sid, area: polyArea(poly) });
            break;
          }
        }
      });
      candidates.sort((a, b) => a.area - b.area);

      // Determine split vs adjacent: a split has new chain vertices INSIDE the sector
      let splitSectorId: string | null = null;
      for (const cand of candidates) {
        if (drawChain.length > 2) {
          const poly = buildSectorPoly(cand.sid);
          if (!poly) continue;
          // Check if any new (non-existing) vertex is inside this sector
          let anyNewInside = false;
          for (let i = 1; i < drawChain.length - 1; i++) {
            if (!drawChain[i].existingId && pointInPoly(drawChain[i].x, drawChain[i].y, poly)) {
              anyNewInside = true;
              break;
            }
          }
          if (!anyNewInside) continue;
        }
        splitSectorId = cand.sid;
        break;
      }

      if (splitSectorId) {
        // For single-line split, check that no linedef already exists between endpoints
        if (drawChain.length === 2) {
          const va = first.existingId!, vb = last.existingId!;
          let alreadyConnected = false;
          maps.linedefs.forEach(ld => {
            if ((ld.v1 === va && ld.v2 === vb) || (ld.v1 === vb && ld.v2 === va)) alreadyConnected = true;
          });
          if (alreadyConnected) {
            showToast('Vertices already connected by a linedef');
            resetDraw();
            draw();
            return;
          }
        }
        await splitSector(drawChain, splitSectorId);
        resetDraw();
        draw();
        return;
      }

      // No split (midpoint outside sector) — adjacent sector creation
      // Expand chain with boundary vertices so existing linedefs get shared
      if (candidates.length > 0) {
        const expanded = expandChainWithBoundary(drawChain, candidates[0].sid);
        if (expanded) {
          await createSectorFromPolygon(expanded);
          resetDraw();
          draw();
          return;
        }
      }
    }
  }
  if (drawChain.length < 3) {
    showToast('Need at least 3 vertices to create a sector');
    resetDraw();
    draw();
    return;
  }
  await createSectorFromPolygon(drawChain);
  resetDraw();
  draw();
}

function handleDrawClick(wx: number, wy: number): void {
  const swx = snap(wx), swy = snap(wy);
  const existingVid = nearestVertex(wx, wy);

  let clickX: number, clickY: number;
  let clickExisting: string | null = null;

  if (existingVid) {
    const v = maps.vertices.get(existingVid)!;
    clickX = v.x; clickY = v.y;
    clickExisting = existingVid;
  } else {
    clickX = swx; clickY = swy;
  }

  // ── First click ──
  if (drawChain.length === 0) {
    drawChain.push({ x: clickX, y: clickY, existingId: clickExisting });
    syncDrawPoints();
    draw();
    return;
  }

  const first = drawChain[0];
  const last = drawChain[drawChain.length - 1];

  // Ignore same position as last
  if (clickX === last.x && clickY === last.y) return;

  const CLOSE_THRESH = 24 / zoom;

  // ── Close at start (both existing and new first) ──
  if (drawChain.length >= 3) {
    const nearFirst = Math.hypot(clickX - first.x, clickY - first.y) < CLOSE_THRESH;
    const isFirstVert = clickExisting !== null && clickExisting === first.existingId;
    if (nearFirst || isFirstVert) {
      if (!validateNewEdge(last.x, last.y, first.x, first.y)) {
        showToast('Closing edge would intersect'); return;
      }
      completeSector();
      return;
    }
  }

  // ── Close at different existing vert (first must be existing) ──
  if (first.existingId && drawChain.length >= 1 && clickExisting &&
      !drawChain.some(p => p.existingId === clickExisting)) {
    // Validate last → click
    if (!validateNewEdge(last.x, last.y, clickX, clickY)) {
      showToast('Edge would intersect'); return;
    }
    // For non-split polygons, also validate closing edge (click → first)
    // For splits the closing edge runs along the sector boundary, not through free space
    const isSplit = (() => {
      let found = false;
      maps.sectors.forEach((_, sid) => {
        if (found) return;
        const loops = buildSectorLoopIds(sid);
        for (const loop of loops) {
          if (loop.includes(first.existingId!) && loop.includes(clickExisting!)) {
            found = true;
            break;
          }
        }
      });
      return found;
    })();
    if (!isSplit && !validateNewEdge(clickX, clickY, first.x, first.y)) {
      showToast('Closing edge would intersect'); return;
    }
    drawChain.push({ x: clickX, y: clickY, existingId: clickExisting });
    completeSector(true);
    return;
  }

  // ── Normal add ──
  if (!validateNewEdge(last.x, last.y, clickX, clickY)) {
    showToast('Edge would intersect'); return;
  }

  drawChain.push({ x: clickX, y: clickY, existingId: clickExisting });
  syncDrawPoints();
  draw();
}

// ── Public init ──

export function initCanvasInput(canvas: HTMLCanvasElement): void {
  function getCanvasXY(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('dblclick', e => {
    if (tool !== 'select') return;
    const { sx, sy } = getCanvasXY(e);
    const { x: wx, y: wy } = s2w(sx, sy);
    const lid = nearestLinedef(wx, wy);
    if (lid === null) return;
    splitLinedefAtPoint(lid, snap(wx), snap(wy));
    draw();
  });

  canvas.addEventListener('mousemove', e => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    const { sx, sy } = getCanvasXY(e);
    setMouseWorld(s2w(sx, sy));
    document.getElementById('coords')!.textContent =
      `${Math.round(mouseWorld.x)}, ${Math.round(mouseWorld.y)}`;

    if (isPanning) {
      pan.x = panStart.px + (e.clientX - panStart.mx);
      pan.y = panStart.py + (e.clientY - panStart.my);
      draw(); return;
    }

    if (multiDragOrigins && multiDragAnchorId) {
      const anchorOrig = multiDragOrigins.get(multiDragAnchorId)!;
      const rawX = anchorOrig.x + (mouseWorld.x - anchorOrig.x) + dragOffset.x;
      const rawY = anchorOrig.y + (mouseWorld.y - anchorOrig.y) + dragOffset.y;
      const anchorX = e.altKey ? rawX : snap(rawX);
      const anchorY = e.altKey ? rawY : snap(rawY);
      const dx = anchorX - anchorOrig.x;
      const dy = anchorY - anchorOrig.y;
      for (const [vid, orig] of multiDragOrigins) {
        mapRef('vertices').child(vid).update({ x: orig.x + dx, y: orig.y + dy });
      }
      return;
    }

    if (dragState) {
      const rawX = mouseWorld.x + dragOffset.x, rawY = mouseWorld.y + dragOffset.y;
      const wx = e.altKey ? rawX : snap(rawX), wy = e.altKey ? rawY : snap(rawY);
      if (dragState.type === 'vertex') mapRef('vertices').child(dragState.id).update({ x: wx, y: wy });
      else if (dragState.type === 'thing') mapRef('things').child(dragState.id).update({ x: wx, y: wy });
      return;
    }

    if (boxSelectStart) {
      draw(); return;
    }

    if (tool === 'select') {
      const wx = mouseWorld.x, wy = mouseWorld.y;
      const vid = nearestVertex(wx, wy);
      const tid = vid === null ? nearestThing(wx, wy) : null;
      const lid = vid === null && tid === null ? nearestLinedef(wx, wy) : null;
      let h: Selection | null = null;
      if (vid !== null) h = { type: 'vertex', id: vid };
      else if (tid !== null) h = { type: 'thing', id: tid };
      else if (lid !== null) h = { type: 'linedef', id: lid };
      else {
        maps.sectors.forEach((_, sid) => {
          const poly = buildSectorPoly(sid);
          if (poly && pointInPoly(wx, wy, poly)) h = { type: 'sector', id: sid };
        });
      }
      // Update active side when cursor moves over a selected linedef
      if (selected?.type === 'linedef') {
        const side = linedefSide(selected.id, wx, wy);
        if (side !== null && activeSide !== side) {
          setActiveSide(side);
          renderPanel();
        }
      }
      if (hovered?.type !== h?.type || hovered?.id !== h?.id) {
        setHovered(h);
        draw();
      }
    } else if (tool === 'draw') {
      draw(); // redraw preview
    }
  });

  canvas.addEventListener('mousedown', async e => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      setIsPanning(true);
      setPanStart({ mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y });
      e.preventDefault(); return;
    }
    if (e.button !== 0) return;

    const { sx, sy } = getCanvasXY(e);
    const { x: wx, y: wy } = s2w(sx, sy);

    if (tool === 'select') {
      const vid = nearestVertex(wx, wy);
      const tid = nearestThing(wx, wy);
      const lid = nearestLinedef(wx, wy);

      if (vid !== null && e.ctrlKey) {
        // Ctrl+click: toggle vertex in multiSelected
        const next = new Set(multiSelected);
        if (next.has(vid)) next.delete(vid);
        else next.add(vid);
        setMultiSelected(next);
        setSelected(null); renderPanel();
      } else if (vid !== null && multiSelected.size > 0 && multiSelected.has(vid)) {
        // Start multi-drag — anchor is the clicked vertex
        multiDragOrigins = new Map();
        for (const id of multiSelected) {
          const v = maps.vertices.get(id);
          if (v) multiDragOrigins.set(id, { x: v.x, y: v.y });
        }
        multiDragAnchorId = vid;
        const anchorV = maps.vertices.get(vid)!;
        dragOffset = { x: anchorV.x - wx, y: anchorV.y - wy };
      } else if (vid !== null) {
        setMultiSelected(new Set());
        select('vertex', vid);
        setDragState({ type: 'vertex', id: vid });
        const v = maps.vertices.get(vid);
        if (v) { dragOrigin = { ...v }; dragOffset = { x: v.x - wx, y: v.y - wy }; }
      } else if (tid !== null) {
        setMultiSelected(new Set());
        select('thing', tid);
        setDragState({ type: 'thing', id: tid });
        const t = maps.things.get(tid);
        if (t) { dragOrigin = { ...t }; dragOffset = { x: t.x - wx, y: t.y - wy }; }
      } else if (lid !== null) {
        setMultiSelected(new Set());
        setActiveSide(linedefSide(lid, wx, wy));
        select('linedef', lid);
      } else {
        // Start box select (works on empty space and over sectors)
        boxSelectAdditive = e.ctrlKey;
        if (!boxSelectAdditive) setMultiSelected(new Set());
        setSelected(null); renderPanel();
        setBoxSelectStart({ x: wx, y: wy });
      }
      draw();

    } else if (tool === 'draw') {
      handleDrawClick(wx, wy);

    } else if (tool === 'thing') {
      beginAction();
      placeThing(snap(wx), snap(wy));
      endAction();
    }
  });

  canvas.addEventListener('mouseup', () => {
    setIsPanning(false);

    // Finalize box select
    if (boxSelectStart) {
      const start = boxSelectStart;
      const end = mouseWorld;
      const dx = Math.abs(end.x - start.x), dy = Math.abs(end.y - start.y);
      const clickThresh = 4 / zoom;
      setBoxSelectStart(null);
      if (dx < clickThresh && dy < clickThresh) {
        // Tiny drag = click — try sector selection
        let found: string | null = null;
        maps.sectors.forEach((_, sid) => {
          const poly = buildSectorPoly(sid);
          if (poly && pointInPoly(start.x, start.y, poly)) found = sid;
        });
        if (found) select('sector', found);
      } else {
        const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
        const sel = boxSelectAdditive ? new Set(multiSelected) : new Set<string>();
        maps.vertices.forEach((v, vid) => {
          if (v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY) sel.add(vid);
        });
        setMultiSelected(sel);
      }
      draw();
      return;
    }

    // Finalize multi-drag
    if (multiDragOrigins && multiDragAnchorId) {
      let moved = false;
      for (const [vid, orig] of multiDragOrigins) {
        const current = maps.vertices.get(vid);
        if (current && (orig.x !== current.x || orig.y !== current.y)) { moved = true; break; }
      }
      if (moved) {
        beginAction();
        for (const [vid, orig] of multiDragOrigins) {
          const current = maps.vertices.get(vid);
          if (current) record(`map/vertices/${vid}`, { ...orig }, { ...current });
        }
        endAction();
      }
      multiDragOrigins = null;
      multiDragAnchorId = null;
      return;
    }

    if (dragState && dragOrigin) {
      const col = dragState.type === 'vertex' ? 'vertices' : 'things';
      const current = maps[col].get(dragState.id);
      if (current && (dragOrigin.x !== current.x || dragOrigin.y !== current.y)) {
        beginAction();
        record(`map/${col}/${dragState.id}`, dragOrigin, { ...current });
        endAction();
      }
    }
    setDragState(null);
    dragOrigin = null;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const { sx, sy } = getCanvasXY(e);
    const before = s2w(sx, sy);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(Math.max(0.05, Math.min(32, zoom * factor)));
    const after = s2w(sx, sy);
    pan.x += (after.x - before.x) * zoom;
    pan.y -= (after.y - before.y) * zoom;
    draw();
  }, { passive: false });
}

export function initKeyboard(canvas: HTMLCanvasElement): (t: ToolType) => void {
  function doSetTool(t: ToolType): void {
    setTool(t);
    resetDraw();
    setHovered(null);
    setMultiSelected(new Set());
    setBoxSelectStart(null);
    document.querySelectorAll<HTMLElement>('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    canvas.style.cursor = (t === 'select') ? 'default' : 'crosshair';
    draw();
  }

  window.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

    // Play: Ctrl+P
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault(); launchWAD(); return;
    }
    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); undo(); return;
    }
    // Redo: Ctrl+Y or Ctrl+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault(); redo(); return;
    }

    if (e.key === ' ')      { setSpaceDown(true); setIsPanning(true); setPanStart({ mx: lastClientX, my: lastClientY, px: pan.x, py: pan.y }); e.preventDefault(); return; }
    if (e.key === 'Enter' && tool === 'draw' && drawChain.length >= 3) {
      const first = drawChain[0], last = drawChain[drawChain.length - 1];
      if (!validateNewEdge(last.x, last.y, first.x, first.y)) { showToast('Closing edge would intersect'); return; }
      completeSector(); return;
    }
    if (e.key === 'Escape') { resetDraw(); setMultiSelected(new Set()); setBoxSelectStart(null); draw(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (multiSelected.size > 0) { deleteMultiSelected(); } else { deleteSelected(); }
      return;
    }
    if (e.key.toLowerCase() === 'm' && tool === 'select') { mergeVertices(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      toggle3D();
      document.getElementById('view3d-btn')?.classList.toggle('active', is3DActive());
      return;
    }
    if (!is3DActive()) {
      if (e.key.toLowerCase() === 's') {
        const lid = nearestLinedef(mouseWorld.x, mouseWorld.y);
        if (lid !== null) { splitLinedefAtPoint(lid, snap(mouseWorld.x), snap(mouseWorld.y)); draw(); }
        return;
      }
      const keyMap: Record<string, ToolType> = { d: 'draw', t: 'thing' };
      const mapped = keyMap[e.key.toLowerCase()];
      if (mapped) doSetTool(mapped);
    }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') { setSpaceDown(false); setIsPanning(false); } });

  return doSetTool;
}
