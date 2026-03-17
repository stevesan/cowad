import {
  maps, tool, selected, hovered, pan, zoom, isPanning, panStart,
  spaceDown, dragState, mouseWorld,
  setSelected, setHovered, setZoom, setIsPanning, setPanStart,
  setSpaceDown, setDragState, setMouseWorld, setTool, setDrawPoints,
} from '../state/appState';
import { mapRef } from '../config/firebase';
import { s2w, snap } from '../canvas/transforms';
import { nearestVertex, nearestLinedef, nearestThing, pointInPoly, polyArea, segmentsProperlyIntersect } from '../geometry/hitTest';
import { buildSectorPoly, buildSectorLoopIds } from '../geometry/cycleFinder';
import { placeThing, deleteSelected, createSectorFromPolygon, splitSector, splitLinedefAtPoint } from '../map/mapActions';
import { draw } from '../canvas/renderer';
import { renderPanel } from './propertiesPanel';
import { beginAction, record, endAction, undo, redo } from '../history/undoRedo';
import { showToast } from './toast';
import type { ToolType, Selection, DrawVertex } from '../types';

function select(type: Selection['type'], id: string): void { setSelected({ type, id }); renderPanel(); }

let dragOrigin: Record<string, any> | null = null;
let dragOffset = { x: 0, y: 0 };

// ── Draw tool state ──
let drawChain: DrawVertex[] = [];

function syncDrawPoints(): void {
  setDrawPoints(drawChain.map(p => ({ x: p.x, y: p.y })));
}

function resetDraw(): void {
  drawChain = [];
  syncDrawPoints();
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
      const midX = drawChain.reduce((s, p) => s + p.x, 0) / drawChain.length;
      const midY = drawChain.reduce((s, p) => s + p.y, 0) / drawChain.length;
      let splitSectorId: string | null = null;
      let bestArea = Infinity;
      maps.sectors.forEach((_, sid) => {
        const loops = buildSectorLoopIds(sid);
        for (const loop of loops) {
          if (loop.includes(first.existingId!) && loop.includes(last.existingId!)) {
            const poly = buildSectorPoly(sid);
            if (poly && pointInPoly(midX, midY, poly)) {
              const a = polyArea(poly);
              if (a < bestArea) { bestArea = a; splitSectorId = sid; }
            }
            break;
          }
        }
      });
      if (splitSectorId) {
        await splitSector(drawChain, splitSectorId);
        resetDraw();
        draw();
        return;
      }
    }
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
    const { sx, sy } = getCanvasXY(e);
    setMouseWorld(s2w(sx, sy));
    document.getElementById('coords')!.textContent =
      `${Math.round(mouseWorld.x)}, ${Math.round(mouseWorld.y)}`;

    if (isPanning) {
      pan.x = panStart.px + (e.clientX - panStart.mx);
      pan.y = panStart.py + (e.clientY - panStart.my);
      draw(); return;
    }

    if (dragState) {
      const wx = snap(mouseWorld.x + dragOffset.x), wy = snap(mouseWorld.y + dragOffset.y);
      if (dragState.type === 'vertex') mapRef('vertices').child(dragState.id).update({ x: wx, y: wy });
      else if (dragState.type === 'thing') mapRef('things').child(dragState.id).update({ x: wx, y: wy });
      return;
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

      if (vid !== null) {
        select('vertex', vid);
        setDragState({ type: 'vertex', id: vid });
        const v = maps.vertices.get(vid);
        if (v) { dragOrigin = { ...v }; dragOffset = { x: v.x - wx, y: v.y - wy }; }
      } else if (tid !== null) {
        select('thing', tid);
        setDragState({ type: 'thing', id: tid });
        const t = maps.things.get(tid);
        if (t) { dragOrigin = { ...t }; dragOffset = { x: t.x - wx, y: t.y - wy }; }
      } else if (lid !== null) {
        select('linedef', lid);
      } else {
        let found: string | null = null;
        maps.sectors.forEach((_, sid) => {
          const poly = buildSectorPoly(sid);
          if (poly && pointInPoly(wx, wy, poly)) found = sid;
        });
        if (found) select('sector', found);
        else { setSelected(null); renderPanel(); }
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
    document.querySelectorAll<HTMLElement>('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    canvas.style.cursor = (t === 'select') ? 'default' : 'crosshair';
    draw();
  }

  window.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); undo(); return;
    }
    // Redo: Ctrl+Y or Ctrl+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault(); redo(); return;
    }

    if (e.key === ' ')      { setSpaceDown(true); e.preventDefault(); return; }
    if (e.key === 'Escape') { resetDraw(); draw(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
    const keyMap: Record<string, ToolType> = { s: 'select', d: 'draw', t: 'thing' };
    const mapped = keyMap[e.key.toLowerCase()];
    if (mapped) doSetTool(mapped);
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') setSpaceDown(false); });

  return doSetTool;
}
