export interface Vertex {
  x: number;
  y: number;
}

export interface Linedef {
  v1: string;
  v2: string;
  flags: number;
  special?: number;
  tag?: number;
  frontSide: string | null;
  backSide: string | null;
}

export interface Sidedef {
  sector: string | null;
  xoff?: number;
  yoff?: number;
  upper: string;
  mid: string;
  lower: string;
}

export interface Sector {
  floor: number;
  ceiling: number;
  light: number;
  special?: number;
  tag?: number;
  floorTex?: string;
  ceilTex?: string;
}

export interface Thing {
  x: number;
  y: number;
  angle: number;
  type: number;
  flags: number;
}

export type HalfSector =
  | { type: 'ceiling'; points: Point[]; ceiling: number; ceilTex?: string; light: number }
  | { type: 'floor';   points: Point[]; floor: number;   floorTex?: string; light: number };

export interface MapData {
  vertices: Map<string, Vertex>;
  linedefs: Map<string, Linedef>;
  sidedefs: Map<string, Sidedef>;
  sectors:  Map<string, Sector>;
  things:   Map<string, Thing>;
  halfSectors: Map<string, HalfSector>;
  [key: string]: Map<string, any>;
}

export type MapCollection = 'vertices' | 'linedefs' | 'sidedefs' | 'sectors' | 'things' | 'halfSectors';

export type ToolType = 'select' | 'draw' | 'halfSector' | 'thing';

export interface DrawVertex {
  x: number;
  y: number;
  existingId: string | null;
}

export interface Selection {
  type: 'vertex' | 'linedef' | 'sector' | 'thing' | 'halfSector';
  id: string;
}

export interface DragState {
  type: 'vertex' | 'thing';
  id: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface ThingInfo {
  name: string;
  cat: string;
  radius: number;
  doom2Only?: boolean;
  ceiling?: boolean;
}

export type GameType = 'doom1' | 'doom2';
