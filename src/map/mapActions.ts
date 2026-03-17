import { mapRef } from '../config/firebase';
import { maps, selected, setSelected, triggerRenderPanel } from '../state/appState';
import { buildSectorPoly, buildSectorLoopIds } from '../geometry/cycleFinder';
import { pointInPoly } from '../geometry/hitTest';
import { beginAction, record, endAction } from '../history/undoRedo';
import type { DrawVertex, Linedef, Point } from '../types';

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
    // Find all sidedefs belonging to this sector
    const sectorSdIds = new Set<string>();
    maps.sidedefs.forEach((sd, sdid) => {
      if (sd.sector === id) sectorSdIds.add(sdid);
    });

    // For each linedef referencing these sidedefs, clean up
    maps.linedefs.forEach((ld, lid) => {
      const frontBelongs = ld.frontSide && sectorSdIds.has(ld.frontSide);
      const backBelongs = ld.backSide && sectorSdIds.has(ld.backSide);
      if (!frontBelongs && !backBelongs) return;

      const ldBefore = { ...ld };

      if (frontBelongs && backBelongs) {
        // Both sides belong to deleted sector — remove entire linedef and both sidedefs
        const fsd = maps.sidedefs.get(ld.frontSide!);
        if (fsd) record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, null);
        mapRef('sidedefs').child(ld.frontSide!).remove();
        const bsd = maps.sidedefs.get(ld.backSide!);
        if (bsd) record(`map/sidedefs/${ld.backSide}`, { ...bsd }, null);
        mapRef('sidedefs').child(ld.backSide!).remove();
        record(`map/linedefs/${lid}`, ldBefore, null);
        mapRef('linedefs').child(lid).remove();
        // Remove orphaned vertices
        for (const vid of [ld.v1, ld.v2]) {
          let used = false;
          maps.linedefs.forEach((other, olid) => {
            if (olid !== lid && (other.v1 === vid || other.v2 === vid)) used = true;
          });
          if (!used) {
            const v = maps.vertices.get(vid);
            if (v) record(`map/vertices/${vid}`, { ...v }, null);
            mapRef('vertices').child(vid).remove();
          }
        }
      } else if (frontBelongs) {
        // Front belongs to deleted sector, back stays — remove front sidedef
        const fsd = maps.sidedefs.get(ld.frontSide!);
        if (fsd) record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, null);
        mapRef('sidedefs').child(ld.frontSide!).remove();
        if (ld.backSide) {
          // Swap back to front, make single-sided
          const updates: Record<string, any> = {
            frontSide: ld.backSide, backSide: null,
            v1: ld.v2, v2: ld.v1,
            flags: ((ld.flags ?? 1) & ~4) | 1,
          };
          record(`map/linedefs/${lid}`, ldBefore, { ...ldBefore, ...updates });
          mapRef('linedefs').child(lid).update(updates);
          // Restore mid texture on the remaining sidedef
          const bsd = maps.sidedefs.get(ld.backSide);
          if (bsd && (!bsd.mid || bsd.mid === '-')) {
            record(`map/sidedefs/${ld.backSide}`, { ...bsd }, { ...bsd, mid: 'STARTAN2' });
            mapRef('sidedefs').child(ld.backSide).update({ mid: 'STARTAN2' });
          }
        } else {
          // No back side either — remove linedef entirely
          record(`map/linedefs/${lid}`, ldBefore, null);
          mapRef('linedefs').child(lid).remove();
        }
      } else if (backBelongs) {
        // Back belongs to deleted sector, front stays — remove back sidedef, make single-sided
        const bsd = maps.sidedefs.get(ld.backSide!);
        if (bsd) record(`map/sidedefs/${ld.backSide}`, { ...bsd }, null);
        mapRef('sidedefs').child(ld.backSide!).remove();
        const updates: Record<string, any> = {
          backSide: null,
          flags: ((ld.flags ?? 1) & ~4) | 1,
        };
        record(`map/linedefs/${lid}`, ldBefore, { ...ldBefore, ...updates });
        mapRef('linedefs').child(lid).update(updates);
        // Restore mid texture on the remaining front sidedef
        const fsd = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
        if (fsd && (!fsd.mid || fsd.mid === '-')) {
          record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, { ...fsd, mid: 'STARTAN2' });
          mapRef('sidedefs').child(ld.frontSide!).update({ mid: 'STARTAN2' });
        }
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

  // 2. Compute winding order (positive signed area = CCW)
  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const a = chain[i], b = chain[(i + 1) % n];
    signedArea2 += a.x * b.y - b.x * a.y;
  }
  const isCCW = signedArea2 > 0;

  // 3. Find or create linedefs for each edge; detect template sector from shared lines
  let templateSector: Record<string, any> | null = null;
  interface EdgeInfo { ldId: string; isNew: boolean; sameDirection: boolean; }
  const edges: EdgeInfo[] = [];
  const newLdData = new Map<string, any>();

  for (let i = 0; i < n; i++) {
    const va = vertexIds[i], vb = vertexIds[(i + 1) % n];
    let existingLdId: string | null = null;
    let sameDir = false;

    maps.linedefs.forEach((ld, lid) => {
      if (ld.v1 === va && ld.v2 === vb) { existingLdId = lid; sameDir = true; }
      else if (ld.v1 === vb && ld.v2 === va) { existingLdId = lid; sameDir = false; }
    });

    if (existingLdId) {
      edges.push({ ldId: existingLdId, isNew: false, sameDirection: sameDir });
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
      // Orient new linedef so front side faces polygon interior
      const v1 = isCCW ? vb : va;
      const v2 = isCCW ? va : vb;
      const ldVal = { v1, v2, flags: 1 };
      const ref = mapRef('linedefs').push(ldVal);
      record(`map/linedefs/${ref.key}`, null, ldVal);
      edges.push({ ldId: ref.key, isNew: true, sameDirection: false });
      newLdData.set(ref.key, ldVal);
    }
  }

  // 4. If no shared lines, check enclosing sector
  let enclosingSectorId: string | null = null;
  if (!templateSector) {
    let cx = 0, cy = 0;
    for (const pt of chain) { cx += pt.x; cy += pt.y; }
    cx /= n; cy /= n;
    maps.sectors.forEach((sec, secId) => {
      if (templateSector) return;
      const poly = buildSectorPoly(secId);
      if (poly && pointInPoly(cx, cy, poly)) {
        templateSector = { ...sec };
        enclosingSectorId = secId;
      }
    });
  }

  // 5. Create sector
  const secProps = templateSector
    ? { floor: templateSector.floor, ceiling: templateSector.ceiling, light: templateSector.light, special: templateSector.special || 0, tag: templateSector.tag || 0, floorTex: templateSector.floorTex || 'FLOOR4_8', ceilTex: templateSector.ceilTex || 'CEIL3_5' }
    : { floor: 0, ceiling: 128, light: 160, special: 0, tag: 0, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' };

  const secRef = await mapRef('sectors').push(secProps);
  const sid = secRef.key;
  record(`map/sectors/${sid}`, null, secProps);

  // 6. Create sidedefs and link to linedefs
  for (let i = 0; i < n; i++) {
    const edge = edges[i];
    const ld: Linedef | undefined = maps.linedefs.get(edge.ldId) || newLdData.get(edge.ldId);
    if (!ld) continue;

    let useFront: boolean;
    if (edge.isNew) {
      useFront = true; // new linedefs are oriented so front = interior
    } else {
      // Correct side: front when (sameDirection XOR isCCW)
      useFront = edge.sameDirection !== isCCW;
      if (useFront && ld.frontSide) continue; // already taken
      if (!useFront && ld.backSide) continue;
    }

    const becomingTwoSided = (useFront ? !!ld.backSide : !!ld.frontSide)
      || (edge.isNew && !!enclosingSectorId);

    const sdVal = {
      sector: sid, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: becomingTwoSided ? '-' : 'STARTAN2', lower: 'STARTAN2',
    };
    const sdRef = await mapRef('sidedefs').push(sdVal);
    record(`map/sidedefs/${sdRef.key}`, null, sdVal);

    const updates: Record<string, any> = useFront ? { frontSide: sdRef.key } : { backSide: sdRef.key };

    // New linedef inside an enclosing sector: create back sidedef for the enclosing sector
    if (edge.isNew && enclosingSectorId) {
      const backSdVal = {
        sector: enclosingSectorId, xoff: 0, yoff: 0,
        upper: 'STARTAN2', mid: '-', lower: 'STARTAN2',
      };
      const backSdRef = await mapRef('sidedefs').push(backSdVal);
      record(`map/sidedefs/${backSdRef.key}`, null, backSdVal);
      updates.backSide = backSdRef.key;
      updates.flags = ((ld.flags ?? 1) | 4) & ~1;
    } else if (becomingTwoSided) {
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

    const ldBefore = maps.linedefs.get(edge.ldId) || newLdData.get(edge.ldId);
    if (ldBefore) record(`map/linedefs/${edge.ldId}`, { ...ldBefore }, { ...ldBefore, ...updates });
    await mapRef('linedefs').child(edge.ldId).update(updates);
  }

  setSelected({ type: 'sector', id: sid });
  triggerRenderPanel();
  endAction();
}

export async function splitSector(chain: DrawVertex[], sectorId: string): Promise<void> {
  const n = chain.length;
  if (n < 2) return;

  const startVid = chain[0].existingId!;
  const endVid = chain[n - 1].existingId!;

  // Capture loops BEFORE modifications
  const loops = buildSectorLoopIds(sectorId);
  let targetLoop: string[] | null = null;
  for (const loop of loops) {
    if (loop.includes(startVid) && loop.includes(endVid)) {
      targetLoop = loop;
      break;
    }
  }
  if (!targetLoop) return;

  const si = targetLoop.indexOf(startVid);
  const ei = targetLoop.indexOf(endVid);
  const loopLen = targetLoop.length;

  // path1: si→ei forward in loop (gets new sector)
  const path1: string[] = [];
  for (let i = si; ; ) {
    path1.push(targetLoop[i]);
    if (i === ei) break;
    i = (i + 1) % loopLen;
  }

  // path2: ei→si forward in loop (keeps original sector)
  const path2: string[] = [];
  for (let i = ei; ; ) {
    path2.push(targetLoop[i]);
    if (i === si) break;
    i = (i + 1) % loopLen;
  }

  beginAction();

  // 1. Create vertices for chain intermediates
  const chainVids: string[] = [startVid];
  for (let i = 1; i < n - 1; i++) {
    const pt = chain[i];
    if (pt.existingId) {
      chainVids.push(pt.existingId);
    } else {
      const val = { x: pt.x, y: pt.y };
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      chainVids.push(ref.key);
    }
  }
  chainVids.push(endVid);

  // 2. Create new sector with same properties
  const origSec = maps.sectors.get(sectorId)!;
  const secProps = { ...origSec };
  const secRef = await mapRef('sectors').push(secProps);
  const newSid = secRef.key;
  record(`map/sectors/${newSid}`, null, secProps);

  // 3. Reassign path1 edges: change sidedefs from original to new sector
  for (let i = 0; i < path1.length - 1; i++) {
    const va = path1[i], vb = path1[i + 1];
    maps.linedefs.forEach((ld, _lid) => {
      if ((ld.v1 === va && ld.v2 === vb) || (ld.v1 === vb && ld.v2 === va)) {
        for (const sdId of [ld.frontSide, ld.backSide]) {
          if (!sdId) continue;
          const sd = maps.sidedefs.get(sdId);
          if (sd && sd.sector === sectorId) {
            record(`map/sidedefs/${sdId}`, { ...sd }, { ...sd, sector: newSid });
            mapRef('sidedefs').child(sdId).update({ sector: newSid });
          }
        }
      }
    });
  }

  // 4. Create chain linedefs (two-sided: front=original, back=new)
  for (let i = 0; i < chainVids.length - 1; i++) {
    const va = chainVids[i], vb = chainVids[i + 1];

    // Skip if linedef already exists between these vertices
    let exists = false;
    maps.linedefs.forEach(ld => {
      if ((ld.v1 === va && ld.v2 === vb) || (ld.v1 === vb && ld.v2 === va)) exists = true;
    });
    if (exists) continue;

    // Orient in chain direction: front (right) = original sector, back (left) = new sector
    const ldVal: any = { v1: va, v2: vb, flags: 4 };
    const ldRef = mapRef('linedefs').push(ldVal);
    record(`map/linedefs/${ldRef.key}`, null, ldVal);

    const frontSdVal = {
      sector: sectorId, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: '-', lower: 'STARTAN2',
    };
    const frontSdRef = await mapRef('sidedefs').push(frontSdVal);
    record(`map/sidedefs/${frontSdRef.key}`, null, frontSdVal);

    const backSdVal = {
      sector: newSid, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: '-', lower: 'STARTAN2',
    };
    const backSdRef = await mapRef('sidedefs').push(backSdVal);
    record(`map/sidedefs/${backSdRef.key}`, null, backSdVal);

    const ldUpdates = { frontSide: frontSdRef.key, backSide: backSdRef.key };
    record(`map/linedefs/${ldRef.key}`, ldVal, { ...ldVal, ...ldUpdates });
    await mapRef('linedefs').child(ldRef.key).update(ldUpdates);
  }

  // 5. Reassign holes to correct sector
  const newSecPoly: Point[] = [];
  for (const vid of path1) {
    const v = maps.vertices.get(vid);
    if (v) newSecPoly.push(v);
  }
  for (let i = chainVids.length - 2; i >= 1; i--) {
    const v = maps.vertices.get(chainVids[i]);
    if (v) newSecPoly.push(v);
  }

  for (const holeLoop of loops) {
    if (holeLoop === targetLoop) continue;
    let cx = 0, cy = 0, cnt = 0;
    for (const vid of holeLoop) {
      const v = maps.vertices.get(vid);
      if (v) { cx += v.x; cy += v.y; cnt++; }
    }
    if (!cnt) continue;
    cx /= cnt; cy /= cnt;

    if (pointInPoly(cx, cy, newSecPoly)) {
      for (let i = 0; i < holeLoop.length; i++) {
        const va = holeLoop[i], vb = holeLoop[(i + 1) % holeLoop.length];
        maps.linedefs.forEach(ld => {
          if ((ld.v1 === va && ld.v2 === vb) || (ld.v1 === vb && ld.v2 === va)) {
            for (const sdId of [ld.frontSide, ld.backSide]) {
              if (!sdId) continue;
              const sd = maps.sidedefs.get(sdId);
              if (sd && sd.sector === sectorId) {
                record(`map/sidedefs/${sdId}`, { ...sd }, { ...sd, sector: newSid });
                mapRef('sidedefs').child(sdId).update({ sector: newSid });
              }
            }
          }
        });
      }
    }
  }

  setSelected({ type: 'sector', id: newSid });
  triggerRenderPanel();
  endAction();
}
