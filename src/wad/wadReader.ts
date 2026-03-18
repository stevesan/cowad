export interface WadLump {
  name: string;
  offset: number;
  size: number;
}

export interface WadFile {
  type: 'IWAD' | 'PWAD';
  lumps: WadLump[];
  data: ArrayBuffer;
}

export function parseWad(buffer: ArrayBuffer): WadFile {
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'IWAD' && magic !== 'PWAD') throw new Error('Not a WAD file');

  const numLumps = dv.getInt32(4, true);
  const dirOffset = dv.getInt32(8, true);

  const lumps: WadLump[] = [];
  for (let i = 0; i < numLumps; i++) {
    const entryOff = dirOffset + i * 16;
    const offset = dv.getInt32(entryOff, true);
    const size = dv.getInt32(entryOff + 4, true);
    let name = '';
    for (let c = 0; c < 8; c++) {
      const ch = dv.getUint8(entryOff + 8 + c);
      if (ch === 0) break;
      name += String.fromCharCode(ch);
    }
    lumps.push({ name: name.toUpperCase(), offset, size });
  }

  return { type: magic as 'IWAD' | 'PWAD', lumps, data: buffer };
}

export function getLump(wad: WadFile, name: string): { dv: DataView; offset: number; size: number } | null {
  const n = name.toUpperCase();
  const lump = wad.lumps.find(l => l.name === n);
  if (!lump || lump.size === 0) return null;
  return { dv: new DataView(wad.data, lump.offset, lump.size), offset: lump.offset, size: lump.size };
}

export function getLumpsByName(wad: WadFile, name: string): WadLump[] {
  const n = name.toUpperCase();
  return wad.lumps.filter(l => l.name === n);
}

export function getLumpsBetween(wad: WadFile, startMarker: string, endMarker: string): WadLump[] {
  const s = startMarker.toUpperCase();
  const e = endMarker.toUpperCase();
  const result: WadLump[] = [];
  let inside = false;
  for (const lump of wad.lumps) {
    if (lump.name === s) { inside = true; continue; }
    if (lump.name === e) { inside = false; continue; }
    if (inside && lump.size > 0) result.push(lump);
  }
  return result;
}
