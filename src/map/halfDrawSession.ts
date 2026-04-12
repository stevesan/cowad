import { mapRef } from '../config/firebase';
import { halfSectorType, setDrawPoints, zoom } from '../state/appState';
import { snap } from '../canvas/transforms';
import { VERTEX_PICK_PX } from '../config/ux';
import { beginAction, record, endAction } from '../history/undoRedo';
import { showToast } from '../ui/toast';
import type { Point, HalfSector } from '../types';

let chain: Point[] = [];

function syncPreview(): void {
  setDrawPoints(chain.map(p => ({ x: p.x, y: p.y })));
}

export function halfDrawReset(): void {
  chain = [];
  syncPreview();
}

export function getHalfDrawChain(): ReadonlyArray<Point> {
  return chain;
}

function defaultsForType(type: 'floor' | 'ceiling'): Partial<HalfSector> {
  if (type === 'floor') return { height: 0, tex: 'FLOOR4_8', light: 160 };
  return { height: 128, tex: 'CEIL3_5', light: 160 };
}

async function commit(): Promise<void> {
  if (chain.length < 3) return;
  beginAction();
  const val: HalfSector = {
    type: halfSectorType,
    outline: chain.map(p => ({ x: p.x, y: p.y })),
    ...defaultsForType(halfSectorType),
  };
  const ref = mapRef('halfSectors').push(val);
  record(`map/halfSectors/${ref.key}`, null, val);
  endAction();
  halfDrawReset();
}

export async function halfDrawClick(wx: number, wy: number): Promise<void> {
  const swx = snap(wx), swy = snap(wy);

  if (chain.length === 0) {
    chain.push({ x: swx, y: swy });
    syncPreview();
    return;
  }

  const first = chain[0];
  const last  = chain[chain.length - 1];
  if (swx === last.x && swy === last.y) return;

  // Close at start
  const CLOSE_THRESH = VERTEX_PICK_PX / zoom;
  if (chain.length >= 3 && Math.hypot(swx - first.x, swy - first.y) < CLOSE_THRESH) {
    await commit();
    return;
  }

  chain.push({ x: swx, y: swy });
  syncPreview();
}

export async function halfDrawComplete(): Promise<boolean> {
  if (chain.length < 3) { showToast('Need at least 3 points'); return false; }
  await commit();
  return true;
}
