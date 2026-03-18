import { parseWad, getLump, getLumpsBetween, type WadFile } from './wadReader';

export interface TextureEntry {
  name: string;
  type: 'flat' | 'wall';
  width: number;
  height: number;
  dataUrl: string;
}

// ── Palette ──

type Palette = Uint8Array; // 768 bytes: R,G,B * 256

function parsePalette(wad: WadFile): Palette {
  const lump = getLump(wad, 'PLAYPAL');
  if (!lump) throw new Error('PLAYPAL lump not found');
  const pal = new Uint8Array(768);
  for (let i = 0; i < 768; i++) pal[i] = lump.dv.getUint8(i);
  return pal;
}

// ── Flats (floor/ceiling textures) ──

function extractFlats(wad: WadFile, palette: Palette): TextureEntry[] {
  const results: TextureEntry[] = [];
  // Collect flats from all F_START/F_END, F1_START/F1_END, F2_START/F2_END, FF_START/FF_END
  const markers: [string, string][] = [
    ['F_START', 'F_END'],
    ['F1_START', 'F1_END'],
    ['F2_START', 'F2_END'],
    ['FF_START', 'FF_END'],
  ];
  const seen = new Set<string>();
  for (const [start, end] of markers) {
    const lumps = getLumpsBetween(wad, start, end);
    for (const lump of lumps) {
      if (lump.size !== 4096 || seen.has(lump.name)) continue;
      seen.add(lump.name);
      const raw = new Uint8Array(wad.data, lump.offset, 4096);
      const imageData = new ImageData(64, 64);
      const d = imageData.data;
      for (let i = 0; i < 4096; i++) {
        const ci = raw[i];
        d[i * 4] = palette[ci * 3];
        d[i * 4 + 1] = palette[ci * 3 + 1];
        d[i * 4 + 2] = palette[ci * 3 + 2];
        d[i * 4 + 3] = 255;
      }
      results.push({
        name: lump.name,
        type: 'flat',
        width: 64,
        height: 64,
        dataUrl: imageDataToUrl(imageData),
      });
    }
  }
  return results;
}

// ── Patch decoding (DOOM picture format) ──

interface PatchPixels {
  width: number;
  height: number;
  pixels: Uint8Array; // w*h palette indices, 255 = transparent
}

function decodePatch(data: ArrayBuffer, offset: number, size: number): PatchPixels | null {
  if (size < 8) return null;
  const dv = new DataView(data, offset, size);
  const width = dv.getUint16(0, true);
  const height = dv.getUint16(2, true);
  // leftOffset = dv.getInt16(4, true); topOffset = dv.getInt16(6, true); // not needed for rendering

  if (width === 0 || height === 0 || width > 4096 || height > 4096) return null;
  if (size < 8 + width * 4) return null;

  const pixels = new Uint8Array(width * height);
  pixels.fill(255); // transparent

  for (let col = 0; col < width; col++) {
    let colOffset = dv.getUint32(8 + col * 4, true);
    if (colOffset >= size) continue;

    let prevDelta = 0;
    while (colOffset < size) {
      const topDelta = dv.getUint8(colOffset);
      if (topDelta === 0xFF) break;
      colOffset++;

      // Tall patch support: if topDelta <= prevDelta, it's relative
      const rowStart = topDelta <= prevDelta && prevDelta > 0
        ? prevDelta + topDelta
        : topDelta;
      prevDelta = rowStart;

      if (colOffset >= size) break;
      const length = dv.getUint8(colOffset);
      colOffset++; // length
      colOffset++; // padding byte

      for (let row = 0; row < length; row++) {
        if (colOffset >= size) break;
        const y = rowStart + row;
        if (y < height) {
          pixels[y * width + col] = dv.getUint8(colOffset);
        }
        colOffset++;
      }
      colOffset++; // padding byte
    }
  }

  return { width, height, pixels };
}

// ── Wall textures (TEXTURE1/TEXTURE2 + PNAMES compositor) ──

function extractWallTextures(wad: WadFile, palette: Palette): TextureEntry[] {
  // Parse PNAMES
  const pnamesLump = getLump(wad, 'PNAMES');
  if (!pnamesLump) return [];
  const pnameCount = pnamesLump.dv.getInt32(0, true);
  const patchNames: string[] = [];
  for (let i = 0; i < pnameCount; i++) {
    let name = '';
    for (let c = 0; c < 8; c++) {
      const ch = pnamesLump.dv.getUint8(4 + i * 8 + c);
      if (ch === 0) break;
      name += String.fromCharCode(ch);
    }
    patchNames.push(name.toUpperCase());
  }

  // Build patch name → lump lookup
  const patchLumpMap = new Map<string, { offset: number; size: number }>();
  // Patches live between P_START/P_END, PP_START/PP_END, or just by name
  const patchLumps = [
    ...getLumpsBetween(wad, 'P_START', 'P_END'),
    ...getLumpsBetween(wad, 'PP_START', 'PP_END'),
  ];
  for (const l of patchLumps) {
    if (!patchLumpMap.has(l.name)) patchLumpMap.set(l.name, { offset: l.offset, size: l.size });
  }
  // Also look up by direct name for any not found in markers
  for (const name of patchNames) {
    if (!patchLumpMap.has(name)) {
      const found = wad.lumps.find(l => l.name === name && l.size > 0);
      if (found) patchLumpMap.set(name, { offset: found.offset, size: found.size });
    }
  }

  // Decode patches on demand (cache)
  const patchCache = new Map<string, PatchPixels | null>();
  function getPatch(name: string): PatchPixels | null {
    if (patchCache.has(name)) return patchCache.get(name)!;
    const info = patchLumpMap.get(name);
    if (!info) { patchCache.set(name, null); return null; }
    const patch = decodePatch(wad.data, info.offset, info.size);
    patchCache.set(name, patch);
    return patch;
  }

  // Parse TEXTURE1 and TEXTURE2
  const results: TextureEntry[] = [];
  for (const texLumpName of ['TEXTURE1', 'TEXTURE2']) {
    const lump = getLump(wad, texLumpName);
    if (!lump) continue;

    const count = lump.dv.getInt32(0, true);
    for (let t = 0; t < count; t++) {
      const texOffset = lump.dv.getInt32(4 + t * 4, true);
      // Texture definition (relative to lump start)
      let p = texOffset;
      let name = '';
      for (let c = 0; c < 8; c++) {
        const ch = lump.dv.getUint8(p + c);
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      name = name.toUpperCase();
      p += 8;
      p += 4; // masked (unused)
      const texWidth = lump.dv.getUint16(p, true); p += 2;
      const texHeight = lump.dv.getUint16(p, true); p += 2;
      p += 4; // column directory (unused)
      const patchCount = lump.dv.getUint16(p, true); p += 2;

      if (texWidth === 0 || texHeight === 0 || texWidth > 4096 || texHeight > 4096) continue;

      // Composite: palette-indexed pixel buffer
      const pixels = new Uint8Array(texWidth * texHeight);
      pixels.fill(255);

      for (let pi = 0; pi < patchCount; pi++) {
        const originX = lump.dv.getInt16(p, true); p += 2;
        const originY = lump.dv.getInt16(p, true); p += 2;
        const patchIdx = lump.dv.getUint16(p, true); p += 2;
        p += 4; // stepdir + colormap (unused)

        if (patchIdx >= patchNames.length) continue;
        const patch = getPatch(patchNames[patchIdx]);
        if (!patch) continue;

        // Blit patch onto texture
        for (let py = 0; py < patch.height; py++) {
          const dy = originY + py;
          if (dy < 0 || dy >= texHeight) continue;
          for (let px = 0; px < patch.width; px++) {
            const dx = originX + px;
            if (dx < 0 || dx >= texWidth) continue;
            const srcPix = patch.pixels[py * patch.width + px];
            if (srcPix !== 255) {
              pixels[dy * texWidth + dx] = srcPix;
            }
          }
        }
      }

      // Convert to RGBA ImageData
      const imageData = new ImageData(texWidth, texHeight);
      const d = imageData.data;
      for (let i = 0; i < texWidth * texHeight; i++) {
        const ci = pixels[i];
        if (ci === 255) {
          // Transparent — use cyan like DOOM editors
          d[i * 4] = 0; d[i * 4 + 1] = 255; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
        } else {
          d[i * 4] = palette[ci * 3];
          d[i * 4 + 1] = palette[ci * 3 + 1];
          d[i * 4 + 2] = palette[ci * 3 + 2];
          d[i * 4 + 3] = 255;
        }
      }

      results.push({
        name,
        type: 'wall',
        width: texWidth,
        height: texHeight,
        dataUrl: imageDataToUrl(imageData),
      });
    }
  }

  return results;
}

// ── ImageData → data URL ──

const _canvas = document.createElement('canvas');
const _ctx = _canvas.getContext('2d')!;

function imageDataToUrl(img: ImageData): string {
  _canvas.width = img.width;
  _canvas.height = img.height;
  _ctx.putImageData(img, 0, 0);
  return _canvas.toDataURL();
}

// ── Public API ──

let textures: Map<string, TextureEntry> = new Map();

export function getTextures(): Map<string, TextureEntry> { return textures; }
export function getTextureDataUrl(name: string): string | null {
  return textures.get(name.toUpperCase())?.dataUrl ?? null;
}
export function isWadLoaded(): boolean { return textures.size > 0; }

export async function importWad(file: File): Promise<{ flats: number; walls: number }> {
  const buffer = await file.arrayBuffer();
  const wad = parseWad(buffer);
  const palette = parsePalette(wad);

  const flats = extractFlats(wad, palette);
  const walls = extractWallTextures(wad, palette);

  textures = new Map();
  for (const t of flats) textures.set(t.name, t);
  for (const t of walls) textures.set(t.name, t);

  return { flats: flats.length, walls: walls.length };
}
