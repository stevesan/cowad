import { mapRef } from '../config/firebase';
import { maps, selected, setSelected, triggerRenderPanel } from '../state/appState';
import { snap } from '../canvas/transforms';
import { findEnclosingCycle } from '../geometry/cycleFinder';
import { showToast } from '../ui/toast';
import type { Linedef, Sidedef } from '../types';

export function placeVertex(wx: number, wy: number): Promise<string> {
  return mapRef('vertices').push({ x: snap(wx), y: snap(wy) }).then((r: FirebaseRef) => r.key);
}

export function placeLine(v1id: string, v2id: string): Promise<FirebaseRef> {
  return mapRef('linedefs').push({ v1: v1id, v2: v2id, flags: 1, frontSide: null, backSide: null });
}

export function placeThing(wx: number, wy: number): void {
  const type = parseInt((document.getElementById('thing-type-sel') as HTMLSelectElement).value, 10);
  mapRef('things').push({ x: snap(wx), y: snap(wy), angle: 0, type, flags: 7 });
}

export function deleteLinedef(lid: string): void {
  const ld = maps.linedefs.get(lid);
  if (!ld) return;
  if (ld.frontSide) mapRef('sidedefs').child(ld.frontSide).remove();
  if (ld.backSide)  mapRef('sidedefs').child(ld.backSide).remove();
  mapRef('linedefs').child(lid).remove();
}

export function deleteSelected(): void {
  if (!selected) return;
  const { type, id } = selected;
  if (type === 'vertex') {
    const lines: string[] = [];
    maps.linedefs.forEach((ld, lid) => { if (ld.v1 === id || ld.v2 === id) lines.push(lid); });
    lines.forEach(deleteLinedef);
    mapRef('vertices').child(id).remove();
  } else if (type === 'linedef') {
    deleteLinedef(id);
  } else if (type === 'sector') {
    maps.sidedefs.forEach((sd, sdid) => {
      if (sd.sector === id) mapRef('sidedefs').child(sdid).update({ sector: null });
    });
    mapRef('sectors').child(id).remove();
  } else if (type === 'thing') {
    mapRef('things').child(id).remove();
  }
  setSelected(null);
  triggerRenderPanel();
}

export async function applySectorTool(wx: number, wy: number): Promise<void> {
  const cycle = findEnclosingCycle(wx, wy);
  if (!cycle) { showToast('No closed region found.'); return; }

  const secRef = await mapRef('sectors').push({ floor: 0, ceiling: 128, light: 160, special: 0, tag: 0, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' });
  const sid = secRef.key;

  for (let i = 0; i < cycle.length; i++) {
    const va = cycle[i], vb = cycle[(i + 1) % cycle.length];
    let matchId: string | null = null;
    let matchLd: Linedef | null = null;
    let reversed = false;
    maps.linedefs.forEach((ld, lid) => {
      if (ld.v1 === va && ld.v2 === vb) { matchId = lid; matchLd = ld; reversed = false; }
      else if (ld.v1 === vb && ld.v2 === va) { matchId = lid; matchLd = ld; reversed = true; }
    });
    if (!matchId || !matchLd) continue;
    const ld = matchLd as Linedef;

    let useFront: boolean;
    if (!ld.frontSide) useFront = true;
    else if (!ld.backSide) useFront = false;
    else continue;

    const becomingTwoSided = useFront ? !!ld.backSide : !!ld.frontSide;

    const sdRef = await mapRef('sidedefs').push({
      sector: sid, xoff: 0, yoff: 0,
      upper: 'STARTAN2',
      mid:   'STARTAN2',
      lower: 'STARTAN2',
    });

    const updates: Record<string, any> = useFront ? { frontSide: sdRef.key } : { backSide: sdRef.key };
    if (becomingTwoSided) {
      updates.flags = (ld.flags ?? 1) | 4 | 1;
      const existingSdId = useFront ? ld.backSide : ld.frontSide;
      const existingSd = existingSdId ? maps.sidedefs.get(existingSdId) : null;
      if (existingSd) {
        const sdFix: Record<string, string> = {};
        if (!existingSd.upper || existingSd.upper === '-') sdFix.upper = 'STARTAN2';
        if (!existingSd.lower || existingSd.lower === '-') sdFix.lower = 'STARTAN2';
        if (!existingSd.mid   || existingSd.mid   === '-') sdFix.mid   = 'STARTAN2';
        if (Object.keys(sdFix).length)
          await mapRef('sidedefs').child(existingSdId!).update(sdFix);
      }
    }
    await mapRef('linedefs').child(matchId).update(updates);
  }

  setSelected({ type: 'sector', id: sid });
  triggerRenderPanel();
}
