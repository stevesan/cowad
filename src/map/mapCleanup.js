import { maps } from '../state/appState.js';
import { mapRef } from '../config/firebase.js';
import { showToast } from '../ui/toast.js';

export function cleanupMap() {
  let removed = { ld: 0, sd: 0, sec: 0, vt: 0 }, fixed = { swap: 0, tex: 0 };

  // 1. Remove linedefs whose vertices no longer exist
  maps.linedefs.forEach((ld, lid) => {
    if (!maps.vertices.has(ld.v1) || !maps.vertices.has(ld.v2)) {
      if (ld.frontSide) mapRef('sidedefs').child(ld.frontSide).remove();
      if (ld.backSide)  mapRef('sidedefs').child(ld.backSide).remove();
      mapRef('linedefs').child(lid).remove();
      removed.ld++;
    }
  });

  // 2. Fix linedefs that have backSide but no frontSide (Doom requires front)
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

  // 3. Fix textures on two-sided linedefs (upper/lower/mid must not be '-')
  maps.linedefs.forEach((ld, lid) => {
    if (!(ld.flags & 4)) return;
    [ld.frontSide, ld.backSide].forEach(sdId => {
      if (!sdId) return;
      const sd = maps.sidedefs.get(sdId);
      if (!sd) return;
      const upd = {};
      if (!sd.upper || sd.upper === '-') upd.upper = 'STARTAN2';
      if (!sd.lower || sd.lower === '-') upd.lower = 'STARTAN2';
      if (!sd.mid   || sd.mid   === '-') upd.mid   = 'STARTAN2';
      if (Object.keys(upd).length) { mapRef('sidedefs').child(sdId).update(upd); fixed.tex++; }
    });
  });

  // 4. Collect sidedefs actually referenced by surviving linedefs
  const usedSdIds = new Set();
  maps.linedefs.forEach(ld => {
    if (ld.frontSide) usedSdIds.add(ld.frontSide);
    if (ld.backSide)  usedSdIds.add(ld.backSide);
  });

  // 5. Remove orphaned sidedefs
  maps.sidedefs.forEach((sd, id) => {
    if (!usedSdIds.has(id)) { mapRef('sidedefs').child(id).remove(); removed.sd++; }
  });

  // 6. Collect sectors actually referenced by surviving sidedefs
  const usedSecIds = new Set();
  maps.sidedefs.forEach((sd, id) => {
    if (usedSdIds.has(id) && sd.sector && maps.sectors.has(sd.sector))
      usedSecIds.add(sd.sector);
  });

  // 7. Remove orphaned sectors
  maps.sectors.forEach((sec, id) => {
    if (!usedSecIds.has(id)) { mapRef('sectors').child(id).remove(); removed.sec++; }
  });

  // 8. Remove orphan vertices
  const usedVerts = new Set();
  maps.linedefs.forEach(ld => { usedVerts.add(ld.v1); usedVerts.add(ld.v2); });
  maps.vertices.forEach((v, id) => {
    if (!usedVerts.has(id)) { mapRef('vertices').child(id).remove(); removed.vt++; }
  });

  const totalRm = removed.ld + removed.sd + removed.sec + removed.vt;
  const totalFx = fixed.swap + fixed.tex;
  const parts = [];
  if (totalRm) parts.push(`removed ${removed.sec}s ${removed.sd}sd ${removed.ld}l ${removed.vt}v`);
  if (fixed.swap) parts.push(`${fixed.swap} back→front swaps`);
  if (fixed.tex)  parts.push(`${fixed.tex} texture fixes`);
  showToast(parts.length ? 'Cleaned: ' + parts.join(', ') : 'Map is clean');
}
