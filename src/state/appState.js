export const uid = Math.random().toString(36).slice(2, 10);

export const maps = {
  vertices: new Map(),
  linedefs: new Map(),
  sidedefs: new Map(),
  sectors:  new Map(),
  things:   new Map(),
};

export let tool      = 'select';
export let selected  = null;    // { type: 'vertex'|'linedef'|'sector'|'thing', id: string }
export let lineStart = null;    // vertex id when drawing a linedef chain
export let pan       = { x: 0, y: 0 };
export let zoom      = 1;
export let isPanning = false;
export let panStart  = { mx: 0, my: 0, px: 0, py: 0 };
export let spaceDown = false;
export let dragState = null;    // { type, id } for dragging vertices/things
export let mouseWorld = { x: 0, y: 0 };

// Setters for primitive exports (can't rebind from outside)
export function setTool(t)      { tool = t; }
export function setSelected(s)  { selected = s; }
export function setLineStart(v) { lineStart = v; }
export function setZoom(z)      { zoom = z; }
export function setIsPanning(v) { isPanning = v; }
export function setPanStart(v)  { panStart = v; }
export function setSpaceDown(v) { spaceDown = v; }
export function setDragState(v) { dragState = v; }
export function setMouseWorld(v){ mouseWorld = v; }

// Callbacks to break circular deps (renderer ↔ sync ↔ panel)
let _draw = () => {};
let _renderPanel = () => {};

export function setCallbacks({ draw, renderPanel }) {
  _draw = draw;
  _renderPanel = renderPanel;
}

export function triggerDraw() { _draw(); }
export function triggerRenderPanel() { _renderPanel(); }
