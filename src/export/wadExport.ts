import { maps, gameType } from '../state/appState';
import { showToast } from '../ui/toast';
import type { Linedef, Sidedef, Sector, Vertex } from '../types';
import { mergeHalfSectors } from './halfSectorMerge';

interface ValidLinedef {
  lid: string;
  ld: Linedef;
  v1i: number;
  v2i: number;
}

interface Seg {
  v1: number;
  v2: number;
  angle: number;
  linedef: number;
  side: number;
  offset: number;
}

function buildWAD(): { wad: ArrayBuffer; msg: string } | null {
  function str8(s: string | null | undefined): Uint8Array {
    const buf = new Uint8Array(8);
    const str = (s == null || s === '') ? '-' : String(s);
    for (let i = 0; i < Math.min(str.length, 8); i++) buf[i] = str.charCodeAt(i);
    return buf;
  }

  // Merge half-sectors into a clone if any exist
  const merged = mergeHalfSectors();
  const mVerts: Map<string, Vertex> = merged ? merged.vertices : maps.vertices;
  const mLines: Map<string, Linedef> = merged ? merged.linedefs : maps.linedefs;
  const mSides: Map<string, Sidedef> = merged ? merged.sidedefs : maps.sidedefs;
  const mSects: Map<string, Sector> = merged ? merged.sectors : maps.sectors;

  const vertIdx = new Map<string, number>();
  let vi = 0; mVerts.forEach((_, id) => vertIdx.set(id, vi++));

  const validLinedefs: ValidLinedef[] = [];
  mLines.forEach((ld, lid) => {
    let v1i = vertIdx.get(ld.v1), v2i = vertIdx.get(ld.v2);
    if (v1i == null || v2i == null || v1i === v2i) return;
    validLinedefs.push({ lid, ld, v1i, v2i });
  });
  const ldIdx = new Map<string, number>();
  validLinedefs.forEach(({ lid }, i) => ldIdx.set(lid, i));

  const usedSdIds = new Set<string>();
  for (const { ld } of validLinedefs) {
    if (ld.frontSide && mSides.has(ld.frontSide)) usedSdIds.add(ld.frontSide);
    if (ld.backSide  && mSides.has(ld.backSide))  usedSdIds.add(ld.backSide);
  }

  const usedSecIds = new Set<string>();
  for (const sdId of usedSdIds) {
    const sd = mSides.get(sdId);
    if (sd && sd.sector && mSects.has(sd.sector)) usedSecIds.add(sd.sector);
  }

  const sdIdx = new Map<string, number>();
  const exportSidedefs: Sidedef[] = [];
  mSides.forEach((sd, id) => {
    if (!usedSdIds.has(id)) return;
    sdIdx.set(id, exportSidedefs.length);
    exportSidedefs.push(sd);
  });

  const secIdx = new Map<string, number>();
  const exportSectors: Sector[] = [];
  mSects.forEach((sec, id) => {
    if (!usedSecIds.has(id)) return;
    secIdx.set(id, exportSectors.length);
    exportSectors.push(sec);
  });

  const nV = mVerts.size, nL = validLinedefs.length,
        nD = exportSidedefs.length, nS = exportSectors.length, nT = maps.things.size;
  const skippedLd  = mLines.size - nL;
  const skippedSd  = mSides.size - nD;
  const skippedSec = mSects.size  - nS;

  const issues: string[] = [];
  if (!nT) issues.push('No things placed');
  else if (![...maps.things.values()].some(t => t.type === 1))
    issues.push('No Player 1 Start (thing type 1) — game will crash on load');
  if (skippedLd)  issues.push(`${skippedLd} degenerate linedef(s) skipped`);
  if (skippedSd)  issues.push(`${skippedSd} orphaned sidedef(s) skipped`);
  if (skippedSec) issues.push(`${skippedSec} orphaned sector(s) skipped`);
  const missingSide = validLinedefs.filter(({ ld }) =>
    (!ld.frontSide || !sdIdx.has(ld.frontSide)) &&
    (!ld.backSide  || !sdIdx.has(ld.backSide))).length;
  if (missingSide) issues.push(`${missingSide} linedef(s) have no valid sidedef`);

  console.group('[WAD Export]');
  console.log(`Exporting: ${nV}v ${nL}l ${nD}sd ${nS}s ${nT}t`);
  if (skippedLd || skippedSd || skippedSec)
    console.log(`Skipped orphans: ${skippedLd}l ${skippedSd}sd ${skippedSec}s`);
  if (issues.length) { console.warn('Issues:'); issues.forEach(s => console.warn('  •', s)); }
  console.groupEnd();

  if (issues.some(s => s.includes('Player 1 Start'))) showToast('Warning: no Player 1 Start');

  // THINGS
  const thingsBuf = new ArrayBuffer(nT * 10);
  const thV = new DataView(thingsBuf); let to = 0;
  maps.things.forEach(th => {
    thV.setInt16(to, Math.round(th.x     ?? 0), true); to += 2;
    thV.setInt16(to, Math.round(th.y     ?? 0), true); to += 2;
    thV.setInt16(to, Math.round(th.angle ?? 0), true); to += 2;
    thV.setInt16(to, th.type  ?? 1,             true); to += 2;
    thV.setInt16(to, th.flags ?? 7,             true); to += 2;
  });

  // LINEDEFS
  const linesBuf = new ArrayBuffer(nL * 14);
  const lV = new DataView(linesBuf); let lo = 0;
  for (const { ld, v1i, v2i } of validLinedefs) {
    lV.setInt16(lo, v1i,            true); lo += 2;
    lV.setInt16(lo, v2i,            true); lo += 2;
    lV.setInt16(lo, ld.flags   ?? 1,true); lo += 2;
    lV.setInt16(lo, ld.special ?? 0,true); lo += 2;
    lV.setInt16(lo, ld.tag     ?? 0,true); lo += 2;
    lV.setInt16(lo, ld.frontSide && sdIdx.has(ld.frontSide) ? sdIdx.get(ld.frontSide)! : -1, true); lo += 2;
    lV.setInt16(lo, ld.backSide  && sdIdx.has(ld.backSide)  ? sdIdx.get(ld.backSide)!  : -1, true); lo += 2;
  }

  // SIDEDEFS
  const sidesBuf = new ArrayBuffer(nD * 30);
  const sV = new DataView(sidesBuf), sU = new Uint8Array(sidesBuf); let so = 0;
  for (const sd of exportSidedefs) {
    sV.setInt16(so, sd.xoff ?? 0, true); so += 2;
    sV.setInt16(so, sd.yoff ?? 0, true); so += 2;
    sU.set(str8(sd.upper), so); so += 8;
    sU.set(str8(sd.lower), so); so += 8;
    sU.set(str8(sd.mid),   so); so += 8;
    sV.setInt16(so, sd.sector != null ? (secIdx.get(sd.sector) ?? 0) : 0, true); so += 2;
  }

  // VERTEXES
  const vertsBuf = new ArrayBuffer(nV * 4);
  const vV = new DataView(vertsBuf); let vo = 0;
  mVerts.forEach(v => {
    vV.setInt16(vo, Math.round(v.x ?? 0), true); vo += 2;
    vV.setInt16(vo, Math.round(v.y ?? 0), true); vo += 2;
  });

  // SEGS
  const segList: Seg[] = [];
  for (const { lid, ld, v1i, v2i } of validLinedefs) {
    const hasFront = ld.frontSide && sdIdx.has(ld.frontSide);
    const hasBack  = ld.backSide  && sdIdx.has(ld.backSide);
    if (!hasFront && !hasBack) continue;
    const v1 = mVerts.get(ld.v1)!, v2 = mVerts.get(ld.v2)!;
    const dx = v2.x - v1.x, dy = v2.y - v1.y;
    const ang = Math.round(Math.atan2(dy, dx) / (2 * Math.PI) * 65536) & 0xFFFF;
    if (hasFront)
      segList.push({ v1: v1i, v2: v2i, angle: ang, linedef: ldIdx.get(lid)!, side: 0, offset: 0 });
    if (hasBack)
      segList.push({ v1: v2i, v2: v1i, angle: (ang + 32768) & 0xFFFF, linedef: ldIdx.get(lid)!, side: 1, offset: 0 });
  }
  const segsBuf = new ArrayBuffer(segList.length * 12);
  const sgV = new DataView(segsBuf); let sgo = 0;
  for (const seg of segList) {
    sgV.setInt16(sgo, seg.v1,       true); sgo += 2;
    sgV.setInt16(sgo, seg.v2,       true); sgo += 2;
    sgV.setUint16(sgo, seg.angle,   true); sgo += 2;
    sgV.setInt16(sgo, seg.linedef,  true); sgo += 2;
    sgV.setInt16(sgo, seg.side,     true); sgo += 2;
    sgV.setInt16(sgo, seg.offset,   true); sgo += 2;
  }

  // SSECTORS
  const ssectorsBuf = segList.length ? new ArrayBuffer(4) : new ArrayBuffer(0);
  if (segList.length) {
    const ssV = new DataView(ssectorsBuf);
    ssV.setInt16(0, segList.length, true);
    ssV.setInt16(2, 0,              true);
  }

  // SECTORS
  const sectsBuf = new ArrayBuffer(nS * 26);
  const seV = new DataView(sectsBuf), seU = new Uint8Array(sectsBuf); let seo = 0;
  for (const sec of exportSectors) {
    seV.setInt16(seo, sec.floor   ?? 0,   true); seo += 2;
    seV.setInt16(seo, sec.ceiling ?? 128, true); seo += 2;
    seU.set(str8(sec.floorTex || 'FLOOR4_8'), seo); seo += 8;
    seU.set(str8(sec.ceilTex  || 'CEIL3_5'),  seo); seo += 8;
    seV.setInt16(seo, sec.light   ?? 160, true); seo += 2;
    seV.setInt16(seo, sec.special ?? 0,   true); seo += 2;
    seV.setInt16(seo, sec.tag     ?? 0,   true); seo += 2;
  }

  // REJECT
  const rejectBuf = new ArrayBuffer(nS > 0 ? Math.ceil((nS * nS) / 8) : 0);

  // BLOCKMAP
  function buildBlockmap(): ArrayBuffer {
    if (!nV || !nL) return new ArrayBuffer(0);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    mVerts.forEach(v => {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    });
    const ox = Math.floor(minX) - 8, oy = Math.floor(minY) - 8;
    const cols = Math.max(1, Math.ceil((maxX - ox) / 128) + 1);
    const rows = Math.max(1, Math.ceil((maxY - oy) / 128) + 1);
    const lineArr = validLinedefs.map(({ ld }, i) => {
      const v1 = mVerts.get(ld.v1)!, v2 = mVerts.get(ld.v2)!;
      return { i, x0: Math.min(v1.x,v2.x), x1: Math.max(v1.x,v2.x),
                  y0: Math.min(v1.y,v2.y), y1: Math.max(v1.y,v2.y) };
    });
    const blockLists: number[][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx0 = ox + c*128, bx1 = bx0 + 128;
        const by0 = oy + r*128, by1 = by0 + 128;
        const list = [0];
        for (const l of lineArr)
          if (l.x1 >= bx0 && l.x0 <= bx1 && l.y1 >= by0 && l.y0 <= by1) list.push(l.i);
        list.push(0xFFFF);
        blockLists.push(list);
      }
    }
    const headerWords = 4 + cols * rows;
    const offsets: number[] = []; let curOff = headerWords;
    for (const bl of blockLists) { offsets.push(curOff); curOff += bl.length; }
    const buf = new ArrayBuffer(curOff * 2);
    const dv = new DataView(buf); let p = 0;
    dv.setInt16(p, ox,   true); p += 2;
    dv.setInt16(p, oy,   true); p += 2;
    dv.setInt16(p, cols, true); p += 2;
    dv.setInt16(p, rows, true); p += 2;
    for (const off of offsets)           { dv.setUint16(p, off, true); p += 2; }
    for (const bl of blockLists) for (const v of bl) { dv.setUint16(p, v, true); p += 2; }
    return buf;
  }

  // Assemble PWAD
  const mapName = gameType === 'doom1' ? 'E1M1' : 'MAP01';
  const lumps = [
    { name: mapName,    buf: new ArrayBuffer(0) },
    { name: 'THINGS',   buf: thingsBuf  },
    { name: 'LINEDEFS', buf: linesBuf   },
    { name: 'SIDEDEFS', buf: sidesBuf   },
    { name: 'VERTEXES', buf: vertsBuf   },
    { name: 'SEGS',     buf: segsBuf    },
    { name: 'SSECTORS', buf: ssectorsBuf},
    { name: 'NODES',    buf: new ArrayBuffer(0) },
    { name: 'SECTORS',  buf: sectsBuf   },
    { name: 'REJECT',   buf: rejectBuf  },
    { name: 'BLOCKMAP', buf: buildBlockmap() },
  ];

  const dataSize  = lumps.reduce((a, l) => a + l.buf.byteLength, 0);
  const dirOffset = 12 + dataSize;
  const wad = new ArrayBuffer(dirOffset + lumps.length * 16);
  const wdv = new DataView(wad), wu8 = new Uint8Array(wad);

  wu8.set([80,87,65,68], 0);
  wdv.setInt32(4, lumps.length, true);
  wdv.setInt32(8, dirOffset,    true);

  let off = 12;
  const entries: { off: number; size: number; name: string }[] = [];
  for (const l of lumps) {
    entries.push({ off, size: l.buf.byteLength, name: l.name });
    if (l.buf.byteLength > 0) { wu8.set(new Uint8Array(l.buf), off); off += l.buf.byteLength; }
  }

  let dp = dirOffset;
  for (const e of entries) {
    wdv.setInt32(dp, e.off,  true); dp += 4;
    wdv.setInt32(dp, e.size, true); dp += 4;
    wu8.set(str8(e.name), dp); dp += 8;
  }

  console.table(entries.map(e => ({ lump: e.name, offset: e.off, size: e.size })));

  let msg = `${mapName}: ${nV}v ${nL}l ${nD}sd ${nS}s ${nT}t`;
  const skipped = skippedLd + skippedSd + skippedSec;
  if (skipped) msg += ` (${skipped} orphans skipped)`;

  return { wad, msg };
}

export function exportWAD(): void {
  const result = buildWAD();
  if (!result) return;
  const { wad, msg } = result;

  const blob = new Blob([wad], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'map.wad';
  a.click();
  URL.revokeObjectURL(a.href);

  showToast(msg);
}

const LAUNCHER_URL = 'http://127.0.0.1:3666';

export async function launchWAD(spawnX?: number, spawnY?: number): Promise<void> {
  const hasPlayerStart = [...maps.things.values()].some(t => t.type === 1);
  if (!hasPlayerStart) {
    showToast('No Player 1 Start on the map — place one before playing');
    return;
  }

  const result = buildWAD();
  if (!result) return;
  const { wad, msg } = result;

  try {
    const params = spawnX != null && spawnY != null ? `?x=${Math.round(spawnX)}&y=${Math.round(spawnY)}` : '';
    const res = await fetch(`${LAUNCHER_URL}/launch${params}`, {
      method: 'POST',
      body: new Uint8Array(wad),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Launched (${data.game}) — ${msg}`);
    } else {
      showToast(`Launch error: ${data.error}`);
    }
  } catch {
    showToast('Launcher not running — start launcher/server.js');
  }
}
