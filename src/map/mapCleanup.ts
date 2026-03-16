import { maps } from '../state/appState';
import { mapRef } from '../config/firebase';
import { showToast } from '../ui/toast';

export function cleanupMap(): void {
  const removed = { ld: 0, sd: 0, sec: 0, vt: 0 };
  const fixed = { swap: 0, tex: 0 };

  maps.linedefs.forEach((ld, lid) => {
    if (!maps.vertices.has(ld.v1) || !maps.vertices.has(ld.v2)) {
      if (ld.frontSide) mapRef('sidedefs').child(ld.frontSide).remove();
      if (ld.backSide)  mapRef('sidedefs').child(ld.backSide).remove();
      mapRef('linedefs').child(lid).remove();
      removed.ld++;
    }
  });

  maps.linedefs.forEach((ld, lid) => {
    if (!ld.frontSide && ld.backSide) {
      mapRef('linedefs').child(lid).update({
        frontSide: ld.backSide, backSide: null,
        v1: ld.v2, v2: ld.v1,
        flags: (ld.flags ?? 1) & ~4 | 1,
      });
      fixed.swap++;
    }
  });

  maps.linedefs.forEach((ld) => {
    if (!(ld.flags & 4)) return;
    [ld.frontSide, ld.backSide].forEach(sdId => {
      if (!sdId) return;
      const sd = maps.sidedefs.get(sdId);
      if (!sd) return;
      const upd: Record<string, string> = {};
      if (!sd.upper || sd.upper === '-') upd.upper = 'STARTAN2';
      if (!sd.lower || sd.lower === '-') upd.lower = 'STARTAN2';
      if (!sd.mid   || sd.mid   === '-') upd.mid   = 'STARTAN2';
      if (Object.keys(upd).length) { mapRef('sidedefs').child(sdId).update(upd); fixed.tex++; }
    });
  });

  const usedSdIds = new Set<string>();
  maps.linedefs.forEach(ld => {
    if (ld.frontSide) usedSdIds.add(ld.frontSide);
    if (ld.backSide)  usedSdIds.add(ld.backSide);
  });

  maps.sidedefs.forEach((_sd, id) => {
    if (!usedSdIds.has(id)) { mapRef('sidedefs').child(id).remove(); removed.sd++; }
  });

  const usedSecIds = new Set<string>();
  maps.sidedefs.forEach((sd, id) => {
    if (usedSdIds.has(id) && sd.sector && maps.sectors.has(sd.sector))
      usedSecIds.add(sd.sector);
  });

  maps.sectors.forEach((_sec, id) => {
    if (!usedSecIds.has(id)) { mapRef('sectors').child(id).remove(); removed.sec++; }
  });

  const usedVerts = new Set<string>();
  maps.linedefs.forEach(ld => { usedVerts.add(ld.v1); usedVerts.add(ld.v2); });
  maps.vertices.forEach((_v, id) => {
    if (!usedVerts.has(id)) { mapRef('vertices').child(id).remove(); removed.vt++; }
  });

  const parts: string[] = [];
  if (removed.ld + removed.sd + removed.sec + removed.vt)
    parts.push(`removed ${removed.sec}s ${removed.sd}sd ${removed.ld}l ${removed.vt}v`);
  if (fixed.swap) parts.push(`${fixed.swap} back→front swaps`);
  if (fixed.tex)  parts.push(`${fixed.tex} texture fixes`);
  showToast(parts.length ? 'Cleaned: ' + parts.join(', ') : 'Map is clean');
}
