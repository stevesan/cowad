import { mapRef } from '../config/firebase.js';
import { maps, selected, setSelected, triggerRenderPanel } from '../state/appState.js';
import { snap } from '../canvas/transforms.js';
import { findEnclosingCycle } from '../geometry/cycleFinder.js';
import { showToast } from '../ui/toast.js';

export function placeVertex(wx, wy) {
  return mapRef('vertices').push({ x: snap(wx), y: snap(wy) }).then(r => r.key);
}

export function placeLine(v1id, v2id) {
  return mapRef('linedefs').push({ v1: v1id, v2: v2id, flags: 1, frontSide: null, backSide: null });
}

export function placeThing(wx, wy) {
  const type = parseInt(document.getElementById('thing-type-sel').value, 10);
  mapRef('things').push({ x: snap(wx), y: snap(wy), angle: 0, type, flags: 7 });
}

export function deleteLinedef(lid) {
  const ld = maps.linedefs.get(lid);
  if (!ld) return;
  if (ld.frontSide) mapRef('sidedefs').child(ld.frontSide).remove();
  if (ld.backSide)  mapRef('sidedefs').child(ld.backSide).remove();
  mapRef('linedefs').child(lid).remove();
}

export function deleteSelected() {
  if (!selected) return;
  const { type, id } = selected;
  if (type === 'vertex') {
    const lines = [];
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

export async function applySectorTool(wx, wy) {
  const cycle = findEnclosingCycle(wx, wy);
  if (!cycle) { showToast('No closed region found.'); return; }

  const secRef = await mapRef('sectors').push({ floor: 0, ceiling: 128, light: 160, special: 0, tag: 0, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' });
  const sid = secRef.key;

  for (let i = 0; i < cycle.length; i++) {
    const va = cycle[i], vb = cycle[(i + 1) % cycle.length];
    let matchId = null, matchLd = null, reversed = false;
    maps.linedefs.forEach((ld, lid) => {
      if (ld.v1 === va && ld.v2 === vb) { matchId = lid; matchLd = ld; reversed = false; }
      else if (ld.v1 === vb && ld.v2 === va) { matchId = lid; matchLd = ld; reversed = true; }
    });
    if (!matchId || !matchLd) continue;

    let useFront;
    if (!matchLd.frontSide) useFront = true;
    else if (!matchLd.backSide) useFront = false;
    else continue;

    const becomingTwoSided = useFront ? !!matchLd.backSide : !!matchLd.frontSide;

    const sdRef = await mapRef('sidedefs').push({
      sector: sid, xoff: 0, yoff: 0,
      upper: 'STARTAN2',
      mid:   'STARTAN2',
      lower: 'STARTAN2',
    });

    const updates = useFront ? { frontSide: sdRef.key } : { backSide: sdRef.key };
    if (becomingTwoSided) {
      updates.flags = (matchLd.flags ?? 1) | 4 | 1;
      const existingSdId = useFront ? matchLd.backSide : matchLd.frontSide;
      const existingSd = existingSdId && maps.sidedefs.get(existingSdId);
      if (existingSd) {
        const sdFix = {};
        if (!existingSd.upper || existingSd.upper === '-') sdFix.upper = 'STARTAN2';
        if (!existingSd.lower || existingSd.lower === '-') sdFix.lower = 'STARTAN2';
        if (!existingSd.mid   || existingSd.mid   === '-') sdFix.mid   = 'STARTAN2';
        if (Object.keys(sdFix).length)
          await mapRef('sidedefs').child(existingSdId).update(sdFix);
      }
    }
    await mapRef('linedefs').child(matchId).update(updates);
  }

  setSelected({ type: 'sector', id: sid });
  triggerRenderPanel();
}
