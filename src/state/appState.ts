import type { MapData, ToolType, Selection, DragState, Point } from '../types';

export const uid: string = Math.random().toString(36).slice(2, 10);

export const maps: MapData = {
  vertices: new Map(),
  linedefs: new Map(),
  sidedefs: new Map(),
  sectors:  new Map(),
  things:   new Map(),
};

export let tool: ToolType      = 'select';
export let selected: Selection | null = null;
export let pan: Point          = { x: 0, y: 0 };
export let zoom: number        = 1;
export let isPanning: boolean  = false;
export let panStart            = { mx: 0, my: 0, px: 0, py: 0 };
export let spaceDown: boolean  = false;
export let dragState: DragState | null = null;
export let mouseWorld: Point   = { x: 0, y: 0 };
export let hovered: Selection | null = null;
export let drawPoints: Point[] = [];
export let multiSelected: Set<string> = new Set();
export let boxSelectStart: Point | null = null;
export let snapSize: number = 8;

export function setTool(t: ToolType): void      { tool = t; }
export function setSelected(s: Selection | null): void { selected = s; }
export function setZoom(z: number): void         { zoom = z; }
export function setIsPanning(v: boolean): void   { isPanning = v; }
export function setPanStart(v: typeof panStart): void { panStart = v; }
export function setSpaceDown(v: boolean): void   { spaceDown = v; }
export function setDragState(v: DragState | null): void { dragState = v; }
export function setMouseWorld(v: Point): void    { mouseWorld = v; }
export function setHovered(h: Selection | null): void { hovered = h; }
export function setDrawPoints(v: Point[]): void  { drawPoints = v; }
export function setMultiSelected(s: Set<string>): void { multiSelected = s; }
export function setBoxSelectStart(p: Point | null): void { boxSelectStart = p; }
export function setSnapSize(v: number): void { snapSize = v; }

let _draw = (): void => {};
let _renderPanel = (): void => {};

export function setCallbacks(cbs: { draw: () => void; renderPanel: () => void }): void {
  _draw = cbs.draw;
  _renderPanel = cbs.renderPanel;
}

export function triggerDraw(): void { _draw(); }
export function triggerRenderPanel(): void { _renderPanel(); }
