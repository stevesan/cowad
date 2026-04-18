import {
  maps, tool, selected, hovered, pan, zoom, isPanning, panStart,
  spaceDown, dragState, mouseWorld, multiSelected, multiSelectType, boxSelectStart, activeSide, snapSize,
  halfSectorType, setHalfSectorType,
  setSelected, setHovered, setZoom, setIsPanning, setPanStart,
  setSpaceDown, setDragState, setMouseWorld, setTool,
  setMultiSelected, setBoxSelectStart, setActiveSide, setDrawPoints,
} from '../state/appState';
import { db, mapRef } from '../config/firebase';
import { s2w, snap } from '../canvas/transforms';
import { nearestVertex, nearestLinedef, nearestThing, halfSectorAt } from '../geometry/hitTest';
import { VERTEX_PICK_PX, LINEDEF_PICK_PX, THING_PICK_PX } from '../config/ux';
import { buildSectorLoopIds, pointInSector } from '../geometry/cycleFinder';
import { placeThing, deleteSelected, deleteMultiSelected, splitLinedefAtPoint, mergeVertices, mergeSectors, bridgeLinedefs, createHalfSector } from '../map/mapActions';
import { drawClick, drawComplete } from '../map/drawSession';
import { createLiveContext } from '../map/exportableMap';
import { draw } from '../canvas/renderer';
import { renderPanel } from './propertiesPanel';
import { beginAction, record, endAction, undo, redo } from '../history/undoRedo';
import { toggle3D, is3DActive, get3DCameraPos } from '../3d/view3d';
import { launchWAD } from '../export/wadExport';
import type { ToolType, Selection, DrawVertex, HalfSector } from '../types';
let drawChain: DrawVertex[] = [];
function drawReset(): void { drawChain = []; setDrawPoints([]); }

function completeHalfSector(): void {
  if (drawChain.length < 3) return;
  createHalfSector(drawChain.map(p => ({ x: p.x, y: p.y })), halfSectorType);
  drawChain = [];
  setDrawPoints([]);
  draw();
}

/** Handle a click in the halfSector tool: add point or close polygon. */
function hsClick(wx: number, wy: number): void {
  const swx = snap(wx), swy = snap(wy);
  const existingVid = nearestVertex(wx, wy, VERTEX_PICK_PX / zoom);
  let clickX: number, clickY: number;
  if (existingVid) {
    const v = maps.vertices.get(existingVid)!;
    clickX = v.x; clickY = v.y;
  } else {
    clickX = swx; clickY = swy;
  }

  // Close when clicking near the first point (3+ points already placed)
  if (drawChain.length >= 3) {
    const first = drawChain[0];
    if (Math.hypot(clickX - first.x, clickY - first.y) < 24 / zoom) {
      completeHalfSector();
      return;
    }
  }

  const next: DrawVertex[] = [...drawChain, { x: clickX, y: clickY, existingId: existingVid }];
  drawChain = next;
  setDrawPoints(next.map(p => ({ x: p.x, y: p.y })));
}

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

// Half-sector drag state
let hsDragId: string | null = null;
let hsDragOrigin: HalfSector | null = null;

// Multi-drag state
let multiDragOrigins: Map<string, { x: number; y: number }> | null = null;
let multiDragAnchorId: string | null = null;
let boxSelectAdditive = false;
let lastClientX = 0, lastClientY = 0;

function collectVerticesForLinedefs(lids: Iterable<string>): Set<string> {
  const verts = new Set<string>();
  for (const lid of lids) {
    const ld = maps.linedefs.get(lid);
    if (ld) { verts.add(ld.v1); verts.add(ld.v2); }
  }
  return verts;
}

function collectVerticesForSectors(sids: Iterable<string>): Set<string> {
  const verts = new Set<string>();
  for (const sid of sids) {
    for (const loop of buildSectorLoopIds(sid)) {
      for (const vid of loop) verts.add(vid);
    }
  }
  return verts;
}

function startVertexDrag(vertexIds: Set<string>, wx: number, wy: number): void {
  multiDragOrigins = new Map();
  let closestVid: string | null = null;
  let closestDist = Infinity;
  for (const vid of vertexIds) {
    const v = maps.vertices.get(vid);
    if (!v) continue;
    multiDragOrigins.set(vid, { x: v.x, y: v.y });
    const d = Math.hypot(v.x - wx, v.y - wy);
    if (d < closestDist) { closestDist = d; closestVid = vid; }
  }
  if (closestVid) {
    multiDragAnchorId = closestVid;
    const anchorV = maps.vertices.get(closestVid)!;
    dragOffset = { x: anchorV.x - wx, y: anchorV.y - wy };
  }
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
    const lid = nearestLinedef(wx, wy, LINEDEF_PICK_PX / zoom);
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

    if (hsDragId && hsDragOrigin) {
      const rawX = mouseWorld.x + dragOffset.x, rawY = mouseWorld.y + dragOffset.y;
      const anchorX = e.altKey ? rawX : snap(rawX);
      const anchorY = e.altKey ? rawY : snap(rawY);
      const dx = anchorX - hsDragOrigin.points[0].x;
      const dy = anchorY - hsDragOrigin.points[0].y;
      const points = hsDragOrigin.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      mapRef('halfSectors').child(hsDragId).update({ points });
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
      const vid = nearestVertex(wx, wy, VERTEX_PICK_PX / zoom);
      const tid = vid === null ? nearestThing(wx, wy, THING_PICK_PX / zoom) : null;
      const lid = vid === null && tid === null ? nearestLinedef(wx, wy, LINEDEF_PICK_PX / zoom) : null;
      let h: Selection | null = null;
      if (vid !== null) h = { type: 'vertex', id: vid };
      else if (tid !== null) h = { type: 'thing', id: tid };
      else if (lid !== null) h = { type: 'linedef', id: lid };
      else {
        maps.sectors.forEach((_, sid) => {
          if (pointInSector(wx, wy, sid)) h = { type: 'sector', id: sid };
        });
        // Check half-sectors if no normal sector hit
        if (!h) {
          const hsId = halfSectorAt(wx, wy);
          if (hsId) h = { type: 'halfSector', id: hsId };
        }
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
    } else if (tool === 'draw' || tool === 'halfSector') {
      draw(); // redraw preview
    }
  });

  canvas.addEventListener('mousedown', async e => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      setIsPanning(true);
      setPanStart({ mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y });
      e.preventDefault(); return;
    }
    if (e.button === 2 && tool === 'draw') {
      drawComplete(drawChain, createLiveContext()).then(r => { drawChain = r.chain; draw(); });
      return;
    }
    if (e.button === 2 && tool === 'halfSector') {
      completeHalfSector();
      return;
    }
    if (e.button !== 0) return;

    const { sx, sy } = getCanvasXY(e);
    const { x: wx, y: wy } = s2w(sx, sy);

    if (tool === 'select') {
      const vid = nearestVertex(wx, wy, VERTEX_PICK_PX / zoom);
      const tid = nearestThing(wx, wy, THING_PICK_PX / zoom);
      const lid = nearestLinedef(wx, wy, LINEDEF_PICK_PX / zoom);

      if (vid !== null && e.shiftKey) {
        // Shift+click: toggle vertex in multiSelected
        const next = multiSelectType === 'vertex' ? new Set(multiSelected) : new Set<string>();
        if (selected?.type === 'vertex' && !next.has(selected.id)) next.add(selected.id);
        if (next.has(vid)) next.delete(vid);
        else next.add(vid);
        setMultiSelected(next, 'vertex');
        setSelected(null); renderPanel();
      } else if (vid !== null && multiSelectType === 'vertex' && multiSelected.size > 0 && multiSelected.has(vid)) {
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
      } else if (lid !== null && e.shiftKey) {
        // Shift+click: toggle linedef in multiSelected
        const next = multiSelectType === 'linedef' ? new Set(multiSelected) : new Set<string>();
        if (selected?.type === 'linedef' && !next.has(selected.id)) next.add(selected.id);
        if (next.has(lid)) next.delete(lid);
        else next.add(lid);
        setMultiSelected(next, 'linedef');
        setSelected(null); renderPanel();
      } else if (lid !== null && multiSelectType === 'linedef' && multiSelected.has(lid)) {
        // Drag multi-selected linedefs
        startVertexDrag(collectVerticesForLinedefs(multiSelected), wx, wy);
      } else if (lid !== null) {
        setMultiSelected(new Set());
        setActiveSide(linedefSide(lid, wx, wy));
        select('linedef', lid);
        startVertexDrag(collectVerticesForLinedefs([lid]), wx, wy);
      } else {
        // Check for sector and half-sector under cursor
        let sectorHit: string | null = null;
        maps.sectors.forEach((_, sid) => {
          if (pointInSector(wx, wy, sid)) sectorHit = sid;
        });
        const hsId = halfSectorAt(wx, wy);

        if (sectorHit !== null && e.shiftKey) {
          // Shift+click: toggle sector in multiSelected
          const next = multiSelectType === 'sector' ? new Set(multiSelected) : new Set<string>();
          // Carry over single-selected sector into multi-selection
          if (selected?.type === 'sector' && !next.has(selected.id)) next.add(selected.id);
          if (next.has(sectorHit)) next.delete(sectorHit);
          else next.add(sectorHit);
          setMultiSelected(next, 'sector');
          setSelected(null); renderPanel();
        } else if (hsId && e.ctrlKey) {
          // Ctrl+drag half-sector (takes priority over Ctrl+drag sector)
          setMultiSelected(new Set());
          select('halfSector', hsId);
          const hs = maps.halfSectors.get(hsId);
          if (hs) {
            hsDragId = hsId;
            hsDragOrigin = { ...hs, points: hs.points.map(p => ({ ...p })) };
            dragOffset = { x: hs.points[0].x - wx, y: hs.points[0].y - wy };
          }
        } else if (sectorHit !== null && e.ctrlKey && multiSelectType === 'sector' && multiSelected.has(sectorHit)) {
          // Ctrl+drag multi-selected sectors
          startVertexDrag(collectVerticesForSectors(multiSelected), wx, wy);
        } else if (sectorHit !== null && e.ctrlKey) {
          setMultiSelected(new Set());
          select('sector', sectorHit);
          startVertexDrag(collectVerticesForSectors([sectorHit]), wx, wy);
        } else if (hsId) {
          setMultiSelected(new Set());
          select('halfSector', hsId);
        } else {
          // Start box select (works on empty space)
          boxSelectAdditive = e.shiftKey;
          setBoxSelectStart({ x: wx, y: wy });
        }
      }
      draw();

    } else if (tool === 'draw') {
      drawChain = await drawClick(drawChain, wx, wy, createLiveContext());
      draw();

    } else if (tool === 'halfSector') {
      hsClick(wx, wy);

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
        if (!boxSelectAdditive) { setMultiSelected(new Set()); setSelected(null); }
        let found: string | null = null;
        maps.sectors.forEach((_, sid) => {
          if (pointInSector(start.x, start.y, sid)) found = sid;
        });
        if (found) select('sector', found);
        else renderPanel();
      } else {
        if (!boxSelectAdditive) setSelected(null);
        const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
        const sel = boxSelectAdditive ? new Set(multiSelected) : new Set<string>();
        maps.vertices.forEach((v, vid) => {
          if (v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY) sel.add(vid);
        });
        if (sel.size === 1) {
          const vid = [...sel][0];
          setMultiSelected(new Set());
          select('vertex', vid);
        } else {
          setMultiSelected(sel, 'vertex');
          renderPanel();
        }
      }
      draw();
      return;
    }

    // Finalize HS drag
    if (hsDragId && hsDragOrigin) {
      const current = maps.halfSectors.get(hsDragId);
      if (current) {
        const moved = current.points.some((p, i) => p.x !== hsDragOrigin!.points[i].x || p.y !== hsDragOrigin!.points[i].y);
        if (moved) {
          beginAction();
          record(`map/halfSectors/${hsDragId}`, hsDragOrigin, { ...current });
          endAction();
        }
      }
      hsDragId = null;
      hsDragOrigin = null;
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

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const wantsZoom = e.ctrlKey || e.metaKey || (!isMac && !e.shiftKey);
    if (wantsZoom) {
      const { sx, sy } = getCanvasXY(e);
      const before = s2w(sx, sy);
      const factor = e.deltaY < 0 ? 1.05625 : 1 / 1.05625;
      setZoom(Math.max(0.05, Math.min(32, zoom * factor)));
      const after = s2w(sx, sy);
      pan.x += (after.x - before.x) * zoom;
      pan.y -= (after.y - before.y) * zoom;
    } else {
      // Two-finger scroll / shift+scroll: pan
      pan.x -= e.deltaX * 1.5;
      pan.y -= e.deltaY * 1.5;
    }
    draw();
  }, { passive: false });
}

export function initKeyboard(canvas: HTMLCanvasElement): (t: ToolType) => void {
  function doSetTool(t: ToolType): void {
    setTool(t);
    drawReset();
    setHovered(null);
    setMultiSelected(new Set());
    setBoxSelectStart(null);
    document.querySelectorAll<HTMLElement>('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    const hsSel = document.getElementById('hs-type-sel') as HTMLSelectElement | null;
    if (hsSel) hsSel.style.display = t === 'halfSector' ? '' : 'none';
    canvas.style.cursor = t === 'select' ? 'crosshair'
      : (t === 'draw' || t === 'halfSector') ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z\' fill=\'white\' stroke=\'black\' stroke-width=\'.5\'/%3E%3C/svg%3E") 2 22, crosshair'
      : 'crosshair';
    draw();
  }

  window.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

    // Play: F5
    if (e.key === 'F5') {
      e.preventDefault();
      const cam = get3DCameraPos();
      const pos = cam ?? mouseWorld;
      let insideSector = false;
      maps.sectors.forEach((_, sid) => {
        if (pointInSector(pos.x, pos.y, sid)) insideSector = true;
      });
      if (insideSector) launchWAD(pos.x, pos.y);
      else launchWAD();
      return;
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
    if (e.key === 'Enter' && tool === 'draw') {
      drawComplete(drawChain, createLiveContext()).then(r => { drawChain = r.chain; draw(); }); return;
    }
    if (e.key === 'Enter' && tool === 'halfSector') { completeHalfSector(); return; }
    if (e.key === 'Escape') { drawReset(); setMultiSelected(new Set()); setBoxSelectStart(null); draw(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (multiSelected.size > 0) { deleteMultiSelected(); } else { deleteSelected(); }
      return;
    }
    if (e.key.toLowerCase() === 'm' && tool === 'select') {
      if (multiSelectType === 'sector') mergeSectors();
      else if (multiSelectType === 'linedef' && multiSelected.size === 2) {
        const [a, b] = [...multiSelected];
        bridgeLinedefs(a, b);
      }
      else mergeVertices();
      return;
    }
    if (e.key === '[' || e.key === ']') {
      const sizes = [1, 2, 4, 8, 16, 32, 64];
      const cur = sizes.indexOf(snapSize);
      const next = e.key === '[' ? Math.max(0, cur - 1) : Math.min(sizes.length - 1, cur + 1);
      if (next !== cur) {
        db.ref('settings/snapSize').set(sizes[next]);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      toggle3D();
      document.getElementById('view3d-btn')?.classList.toggle('active', is3DActive());
      return;
    }
    if (!is3DActive()) {
      if (e.key.toLowerCase() === 'c') {
        const lid = nearestLinedef(mouseWorld.x, mouseWorld.y, LINEDEF_PICK_PX / zoom);
        if (lid !== null) { splitLinedefAtPoint(lid, snap(mouseWorld.x), snap(mouseWorld.y)); draw(); }
        return;
      }
      const keyMap: Record<string, ToolType> = { s: 'select', d: 'draw', h: 'halfSector', t: 'thing' };
      const mapped = keyMap[e.key.toLowerCase()];
      if (mapped) doSetTool(mapped);
    }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') { setSpaceDown(false); setIsPanning(false); } });

  // Wire up half-sector type dropdown
  const hsSel = document.getElementById('hs-type-sel') as HTMLSelectElement | null;
  if (hsSel) {
    hsSel.value = halfSectorType;
    hsSel.addEventListener('change', () => {
      setHalfSectorType(hsSel.value as 'ceiling' | 'floor');
    });
  }

  return doSetTool;
}
