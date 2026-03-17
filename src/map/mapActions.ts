import { mapRef } from '../config/firebase';
import { maps, selected, setSelected, triggerRenderPanel } from '../state/appState';
import { snap } from '../canvas/transforms';
import { findEnclosingCycle } from '../geometry/cycleFinder';
import { showToast } from '../ui/toast';
import { beginAction, record, endAction } from '../history/undoRedo';
import type { Linedef, Sidedef } from '../types';

export function placeVertex(wx: number, wy: number): Promise<string> {
  const val = { x: snap(wx), y: snap(wy) };
  const ref = mapRef('vertices').push(val);
  record(`map/vertices/${ref.key}`, null, val);
  return ref.then((r: FirebaseRef) => r.key);
}

export function placeLine(v1id: string, v2id: string): Promise<FirebaseRef> {
  const val = { v1: v1id, v2: v2id, flags: 1, frontSide: null, backSide: null };
  const ref = mapRef('linedefs').push(val);
  record(`map/linedefs/${ref.key}`, null, val);
  return ref;
}

export function placeThing(wx: number, wy: number): void {
  const type = parseInt((document.getElementById('thing-type-sel') as HTMLSelectElement).value, 10);
  const val = { x: snap(wx), y: snap(wy), angle: 0, type, flags: 7 };
  const ref = mapRef('things').push(val);
  record(`map/things/${ref.key}`, null, val);
}

export function deleteLinedef(lid: string): void {
  const ld = maps.linedefs.get(lid);
  if (!ld) return;
  if (ld.frontSide) {
    const sd = maps.sidedefs.get(ld.frontSide);
    if (sd) record(`map/sidedefs/${ld.frontSide}`, { ...sd }, null);
    mapRef('sidedefs').child(ld.frontSide).remove();
  }
  if (ld.backSide) {
    const sd = maps.sidedefs.get(ld.backSide);
    if (sd) record(`map/sidedefs/${ld.backSide}`, { ...sd }, null);
    mapRef('sidedefs').child(ld.backSide).remove();
  }
  record(`map/linedefs/${lid}`, { ...ld }, null);
  mapRef('linedefs').child(lid).remove();
}

export function deleteSelected(): void {
  if (!selected) return;
  beginAction();
  const { type, id } = selected;
  if (type === 'vertex') {
    const lines: string[] = [];
    maps.linedefs.forEach((ld, lid) => { if (ld.v1 === id || ld.v2 === id) lines.push(lid); });
    lines.forEach(deleteLinedef);
    const v = maps.vertices.get(id);
    if (v) record(`map/vertices/${id}`, { ...v }, null);
    mapRef('vertices').child(id).remove();
  } else if (type === 'linedef') {
    deleteLinedef(id);
  } else if (type === 'sector') {
    maps.sidedefs.forEach((sd, sdid) => {
      if (sd.sector === id) {
        record(`map/sidedefs/${sdid}`, { ...sd }, { ...sd, sector: null });
        mapRef('sidedefs').child(sdid).update({ sector: null });
      }
    });
    const sec = maps.sectors.get(id);
    if (sec) record(`map/sectors/${id}`, { ...sec }, null);
    mapRef('sectors').child(id).remove();
  } else if (type === 'thing') {
    const th = maps.things.get(id);
    if (th) record(`map/things/${id}`, { ...th }, null);
    mapRef('things').child(id).remove();
  }
  endAction();
  setSelected(null);
  triggerRenderPanel();
}

export async function applySectorTool(wx: number, wy: number): Promise<void> {
  const cycle = findEnclosingCycle(wx, wy);
  if (!cycle) { showToast('No closed region found.'); return; }

  const secVal = { floor: 0, ceiling: 128, light: 160, special: 0, tag: 0, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' };
  const secRef = await mapRef('sectors').push(secVal);
  const sid = secRef.key;
  record(`map/sectors/${sid}`, null, secVal);

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

    const sdVal = {
      sector: sid, xoff: 0, yoff: 0,
      upper: 'STARTAN2',
      mid:   'STARTAN2',
      lower: 'STARTAN2',
    };
    const sdRef = await mapRef('sidedefs').push(sdVal);
    record(`map/sidedefs/${sdRef.key}`, null, sdVal);

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
        if (Object.keys(sdFix).length) {
          record(`map/sidedefs/${existingSdId}`, { ...existingSd }, { ...existingSd, ...sdFix });
          await mapRef('sidedefs').child(existingSdId!).update(sdFix);
        }
      }
    }

    const ldBefore = maps.linedefs.get(matchId);
    if (ldBefore) record(`map/linedefs/${matchId}`, { ...ldBefore }, { ...ldBefore, ...updates });
    await mapRef('linedefs').child(matchId).update(updates);
  }

  setSelected({ type: 'sector', id: sid });
  triggerRenderPanel();
}
