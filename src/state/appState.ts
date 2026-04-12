import type { MapData, ToolType, Selection, DragState, Point, GameType, HalfSectorType } from '../types';

export const uid: string = Math.random().toString(36).slice(2, 10);

export const maps: MapData = {
  vertices:    new Map(),
  linedefs:    new Map(),
  sidedefs:    new Map(),
  sectors:     new Map(),
  things:      new Map(),
  halfSectors: new Map(),
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
export let multiSelectType: 'vertex' | 'sector' | 'linedef' | null = null;
export let boxSelectStart: Point | null = null;
export let snapSize: number = 8;
export let activeSide: 'front' | 'back' | null = null;
export let multiSelectedSides: Map<string, string> = new Map(); // linedef ID → sidedef ID
export let gameType: GameType = 'doom2';
export let halfSectorType: HalfSectorType = 'floor';

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
export function setMultiSelected(s: Set<string>, type?: 'vertex' | 'sector' | 'linedef' | null): void { multiSelected = s; if (type !== undefined) multiSelectType = type; if (s.size === 0) { multiSelectType = null; multiSelectedSides = new Map(); } if (multiSelectType !== 'linedef') multiSelectedSides = new Map(); }
export function setMultiSelectedSides(m: Map<string, string>): void { multiSelectedSides = m; }
export function setBoxSelectStart(p: Point | null): void { boxSelectStart = p; }
export function setSnapSize(v: number): void { snapSize = v; }
export function setActiveSide(s: 'front' | 'back' | null): void { activeSide = s; }
export function setGameType(g: GameType): void { gameType = g; }
export function setHalfSectorType(t: HalfSectorType): void { halfSectorType = t; }

let _draw = (): void => {};
let _renderPanel = (): void => {};
let _rebuild3D = (): void => {};

export function setCallbacks(cbs: { draw: () => void; renderPanel: () => void; rebuild3D?: () => void }): void {
  _draw = cbs.draw;
  _renderPanel = cbs.renderPanel;
  if (cbs.rebuild3D) _rebuild3D = cbs.rebuild3D;
}

export function triggerDraw(): void { _draw(); _rebuild3D(); }
export function triggerRenderPanel(): void { _renderPanel(); }
