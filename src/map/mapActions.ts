import { mapRef } from '../config/firebase';
import { maps, selected, setSelected, triggerRenderPanel } from '../state/appState';
import { buildSectorPoly } from '../geometry/cycleFinder';
import { pointInPoly } from '../geometry/hitTest';
import { beginAction, record, endAction } from '../history/undoRedo';
import type { DrawVertex, Linedef } from '../types';

export function placeThing(wx: number, wy: number): void {
  const type = parseInt((document.getElementById('thing-type-sel') as HTMLSelectElement).value, 10);
  const val = { x: wx, y: wy, angle: 0, type, flags: 7 };
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

export async function createSectorFromPolygon(chain: DrawVertex[]): Promise<void> {
  const n = chain.length;
  if (n < 3) return;

  beginAction();

  // 1. Create vertices for new points, reuse existing
  const vertexIds: string[] = [];
  for (const pt of chain) {
    if (pt.existingId) {
      vertexIds.push(pt.existingId);
    } else {
      const val = { x: pt.x, y: pt.y };
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      vertexIds.push(ref.key);
    }
  }

  // 2. Find or create linedefs for each edge; detect template sector from shared lines
  let templateSector: Record<string, any> | null = null;
  const edgeLineIds: string[] = [];
  const newLdData = new Map<string, any>(); // track locally-created linedefs

  for (let i = 0; i < n; i++) {
    const va = vertexIds[i], vb = vertexIds[(i + 1) % n];
    let existingLdId: string | null = null;

    maps.linedefs.forEach((ld, lid) => {
      if ((ld.v1 === va && ld.v2 === vb) || (ld.v1 === vb && ld.v2 === va)) {
        existingLdId = lid;
      }
    });

    if (existingLdId) {
      edgeLineIds.push(existingLdId);
      // Try to copy properties from adjacent sector
      if (!templateSector) {
        const ld = maps.linedefs.get(existingLdId)!;
        const sdId = ld.frontSide || ld.backSide;
        const sd = sdId ? maps.sidedefs.get(sdId) : null;
        if (sd?.sector) {
          const sec = maps.sectors.get(sd.sector);
          if (sec) templateSector = { ...sec };
        }
      }
    } else {
      const ldVal = { v1: va, v2: vb, flags: 1 };
      const ref = mapRef('linedefs').push(ldVal);
      record(`map/linedefs/${ref.key}`, null, ldVal);
      edgeLineIds.push(ref.key);
      newLdData.set(ref.key, ldVal);
    }
  }

  // 3. If no shared lines, check enclosing sector
  if (!templateSector) {
    let cx = 0, cy = 0;
    for (const pt of chain) { cx += pt.x; cy += pt.y; }
    cx /= n; cy /= n;
    maps.sectors.forEach((sec, sid) => {
      if (templateSector) return;
      const poly = buildSectorPoly(sid);
      if (poly && pointInPoly(cx, cy, poly)) {
        templateSector = { ...sec };
      }
    });
  }

  // 4. Create sector
  const secProps = templateSector
    ? { floor: templateSector.floor, ceiling: templateSector.ceiling, light: templateSector.light, special: templateSector.special || 0, tag: templateSector.tag || 0, floorTex: templateSector.floorTex || 'FLOOR4_8', ceilTex: templateSector.ceilTex || 'CEIL3_5' }
    : { floor: 0, ceiling: 128, light: 160, special: 0, tag: 0, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' };

  const secRef = await mapRef('sectors').push(secProps);
  const sid = secRef.key;
  record(`map/sectors/${sid}`, null, secProps);

  // 5. Create sidedefs and link to linedefs
  for (let i = 0; i < n; i++) {
    const ldId = edgeLineIds[i];
    const ld: Linedef | undefined = maps.linedefs.get(ldId) || newLdData.get(ldId);
    if (!ld) continue;

    let useFront: boolean;
    if (!ld.frontSide) useFront = true;
    else if (!ld.backSide) useFront = false;
    else continue;

    const becomingTwoSided = useFront ? !!ld.backSide : !!ld.frontSide;

    const sdVal = {
      sector: sid, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: becomingTwoSided ? '-' : 'STARTAN2', lower: 'STARTAN2',
    };
    const sdRef = await mapRef('sidedefs').push(sdVal);
    record(`map/sidedefs/${sdRef.key}`, null, sdVal);

    const updates: Record<string, any> = useFront ? { frontSide: sdRef.key } : { backSide: sdRef.key };
    if (becomingTwoSided) {
      updates.flags = ((ld.flags ?? 1) | 4) & ~1;
      const existingSdId = useFront ? ld.backSide : ld.frontSide;
      const existingSd = existingSdId ? maps.sidedefs.get(existingSdId) : null;
      if (existingSd) {
        const sdFix: Record<string, any> = {};
        if (!existingSd.upper || existingSd.upper === '-') sdFix.upper = 'STARTAN2';
        if (!existingSd.lower || existingSd.lower === '-') sdFix.lower = 'STARTAN2';
        sdFix.mid = '-';
        record(`map/sidedefs/${existingSdId}`, { ...existingSd }, { ...existingSd, ...sdFix });
        await mapRef('sidedefs').child(existingSdId!).update(sdFix);
      }
    }

    const ldBefore = maps.linedefs.get(ldId) || newLdData.get(ldId);
    if (ldBefore) record(`map/linedefs/${ldId}`, { ...ldBefore }, { ...ldBefore, ...updates });
    await mapRef('linedefs').child(ldId).update(updates);
  }

  setSelected({ type: 'sector', id: sid });
  triggerRenderPanel();
  endAction();
}
