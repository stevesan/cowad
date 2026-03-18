import { pan, zoom, snapSize } from '../state/appState';
import type { Point } from '../types';

export function w2s(wx: number, wy: number): Point { return { x: wx * zoom + pan.x, y: -wy * zoom + pan.y }; }
export function s2w(sx: number, sy: number): Point { return { x: (sx - pan.x) / zoom, y: -(sy - pan.y) / zoom }; }
export function snap(v: number, g: number = snapSize): number { return Math.round(v / g) * g; }
