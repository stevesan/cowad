import { maps } from '../state/appState';
import { mapRef } from '../config/firebase';
import { pointInSector } from '../geometry/cycleFinder';
import { showToast } from '../ui/toast';

export function cleanupMap(): void {
  const removed = { ld: 0, sd: 0, sec: 0, vt: 0 };
  const fixed = { flip: 0, tex: 0 };

  maps.linedefs.forEach((ld, lid) => {
    if (!maps.vertices.has(ld.v1) || !maps.vertices.has(ld.v2)) {
      if (ld.frontSide) mapRef('sidedefs').child(ld.frontSide).remove();
      if (ld.backSide)  mapRef('sidedefs').child(ld.backSide).remove();
      mapRef('linedefs').child(lid).remove();
      removed.ld++;
    }
  });

  // For single-sided linedefs, ensure the sidedef's sector is on the correct
  // side of v1→v2: front = right, back = left.
  maps.linedefs.forEach((ld, lid) => {
    if (ld.frontSide && ld.backSide) return;
    const sdId = ld.frontSide || ld.backSide;
    if (!sdId) return;
    const sd = maps.sidedefs.get(sdId);
    if (!sd?.sector) return;
    const v1 = maps.vertices.get(ld.v1)!;
    const v2 = maps.vertices.get(ld.v2)!;
    const dx = v2.x - v1.x, dy = v2.y - v1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    // Right normal of v1→v2 in y-up: (dy, -dx)
    const eps = 0.1;
    const rx = (v1.x + v2.x) / 2 + (dy / len) * eps;
    const ry = (v1.y + v2.y) / 2 - (dx / len) * eps;
    const sectorIsRight = pointInSector(rx, ry, sd.sector);
    // Front sidedef should be on right, back sidedef should be on left
    const shouldBeRight = !!ld.frontSide;
    if (sectorIsRight !== shouldBeRight) {
      mapRef('linedefs').child(lid).update({ v1: ld.v2, v2: ld.v1 });
      fixed.flip++;
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
  if (fixed.flip) parts.push(`${fixed.flip} facing flips`);
  if (fixed.tex)  parts.push(`${fixed.tex} texture fixes`);
  showToast(parts.length ? 'Cleaned: ' + parts.join(', ') : 'Map is clean');
}
