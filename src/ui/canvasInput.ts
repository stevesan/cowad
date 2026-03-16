import {
  maps, tool, selected, hovered, lineStart, lineChain, pan, zoom, isPanning, panStart,
  spaceDown, dragState, mouseWorld,
  setSelected, setHovered, setLineStart, setLineChain, setZoom, setIsPanning, setPanStart,
  setSpaceDown, setDragState, setMouseWorld, setTool,
} from '../state/appState';
import { mapRef } from '../config/firebase';
import { s2w, snap } from '../canvas/transforms';
import { nearestVertex, nearestLinedef, nearestThing, pointInPoly } from '../geometry/hitTest';
import { buildSectorPoly } from '../geometry/cycleFinder';
import { placeVertex, placeLine, placeThing, applySectorTool, deleteSelected } from '../map/mapActions';
import { draw } from '../canvas/renderer';
import { renderPanel } from './propertiesPanel';
import type { ToolType, Selection } from '../types';

function select(type: Selection['type'], id: string): void { setSelected({ type, id }); renderPanel(); }

export function initCanvasInput(canvas: HTMLCanvasElement): void {
  function getCanvasXY(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());

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
      const wx = snap(mouseWorld.x), wy = snap(mouseWorld.y);
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
    } else if (tool === 'line') {
      draw();
    }
  });

  canvas.addEventListener('mousedown', e => {
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
      } else if (tid !== null) {
        select('thing', tid);
        setDragState({ type: 'thing', id: tid });
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

    } else if (tool === 'vertex') {
      placeVertex(wx, wy);

    } else if (tool === 'line') {
      // Check for loop closure: clicking near chain start with 3+ vertices
      const CLOSE_THRESH = 24 / zoom;
      if (lineStart !== null && lineChain.length >= 3 && lineStart !== lineChain[0]) {
        const startV = maps.vertices.get(lineChain[0]);
        if (startV && Math.hypot(wx - startV.x, wy - startV.y) < CLOSE_THRESH) {
          placeLine(lineStart, lineChain[0]);
          // Compute centroid for sector detection
          let cx = 0, cy = 0, n = 0;
          for (const vid of lineChain) {
            const vtx = maps.vertices.get(vid);
            if (vtx) { cx += vtx.x; cy += vtx.y; n++; }
          }
          if (n > 0) applySectorTool(cx / n, cy / n);
          setLineStart(null);
          setLineChain([]);
          draw();
          return;
        }
      }

      const vid = nearestVertex(wx, wy);
      if (vid !== null) {
        if (lineStart === null) {
          setLineStart(vid);
          setLineChain([vid]);
        } else {
          if (vid !== lineStart) placeLine(lineStart, vid);
          setLineStart(vid);
          setLineChain([...lineChain, vid]);
        }
        draw();
      } else {
        placeVertex(wx, wy).then(newId => {
          if (lineStart !== null) placeLine(lineStart, newId);
          setLineStart(newId);
          setLineChain([...lineChain, newId]);
          draw();
        });
      }

    } else if (tool === 'sector') {
      applySectorTool(wx, wy);

    } else if (tool === 'thing') {
      placeThing(wx, wy);
    }
  });

  canvas.addEventListener('mouseup', () => { setIsPanning(false); setDragState(null); });

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
    setLineStart(null);
    setLineChain([]);
    setHovered(null);
    document.querySelectorAll<HTMLElement>('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    canvas.style.cursor = (t === 'select') ? 'default' : 'crosshair';
    draw();
  }

  window.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
    if (e.key === ' ')      { setSpaceDown(true); e.preventDefault(); return; }
    if (e.key === 'Escape') { setLineStart(null); setLineChain([]); draw(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
    const keyMap: Record<string, ToolType> = { s: 'select', v: 'vertex', l: 'line', e: 'sector', t: 'thing' };
    const mapped = keyMap[e.key.toLowerCase()];
    if (mapped) doSetTool(mapped);
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') setSpaceDown(false); });

  return doSetTool;
}
