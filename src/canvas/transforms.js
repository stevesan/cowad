import { pan, zoom } from '../state/appState.js';
import { SNAP } from '../config/constants.js';

export function w2s(wx, wy) { return { x: wx * zoom + pan.x, y: -wy * zoom + pan.y }; }
export function s2w(sx, sy) { return { x: (sx - pan.x) / zoom, y: -(sy - pan.y) / zoom }; }
export function snap(v, g = SNAP) { return Math.round(v / g) * g; }
