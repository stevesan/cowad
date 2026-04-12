import * as THREE from 'three';
import { maps } from '../state/appState';
import { buildSectorPolys, pointInSector } from '../geometry/cycleFinder';
import { signedArea2 } from '../geometry/polygonMath';
import { getTextureDataUrl, isWadLoaded, getTextures, getSpritePrefixEntry } from '../wad/textureLoader';
import { THINGS, THING_SPRITE } from '../config/constants';
import { CAT_COLOR } from '../config/ux';

// ── Texture cache ──

const texCache = new Map<string, THREE.Texture>();

function getTexture(name: string): THREE.Texture | null {
  if (!isWadLoaded()) return null;
  const key = name.toUpperCase();
  if (key === '-' || key === '') return null;
  if (texCache.has(key)) return texCache.get(key)!;

  const url = getTextureDataUrl(key);
  if (!url) return null;

  const img = new Image();
  img.src = url;
  const tex = new THREE.Texture(img);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  img.onload = () => { tex.needsUpdate = true; };
  if (img.complete) tex.needsUpdate = true;

  texCache.set(key, tex);
  return tex;
}

function getTexSize(name: string): { w: number; h: number } {
  const entry = getTextures().get(name.toUpperCase());
  if (entry) return { w: entry.width, h: entry.height };
  return { w: 64, h: 64 };
}

// ── Materials ──

const BRIGHTNESS_SCALE = 0.5;

function makeMaterial(texName: string, light: number, colorKey = false): THREE.MeshBasicMaterial {
  const brightness = Math.max(0.05, Math.min(1, light / 255)) * BRIGHTNESS_SCALE;
  const tex = getTexture(texName);
  if (tex) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex.clone(),
      color: new THREE.Color(brightness, brightness, brightness),
    });
    if (colorKey) {
      // Discard cyan (0,255,255) pixels — DOOM's transparent color for mid textures
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           if (sampledDiffuseColor.r < 0.1 && sampledDiffuseColor.g > 0.9 && sampledDiffuseColor.b > 0.9) discard;`
        );
      };
    }
    return mat;
  }
  const c = Math.round(brightness * 180);
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(`rgb(${c},${c},${Math.round(c * 0.75)})`),
  });
}

// ── Floors & Ceilings ──

export function buildFloorsCeilings(group: THREE.Group): void {
  maps.sectors.forEach((sec, sid) => {
    const loops = buildSectorPolys(sid);
    if (!loops.length) return;

    // Find outer boundary (largest absolute area)
    let outerIdx = 0;
    let maxArea = 0;
    for (let i = 0; i < loops.length; i++) {
      const a = Math.abs(signedArea2(loops[i]));
      if (a > maxArea) { maxArea = a; outerIdx = i; }
    }

    const outer = loops[outerIdx];
    const shape = new THREE.Shape();
    shape.moveTo(outer[0].x, outer[0].y);
    for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);

    // Add holes
    for (let i = 0; i < loops.length; i++) {
      if (i === outerIdx) continue;
      const hole = loops[i];
      const path = new THREE.Path();
      path.moveTo(hole[0].x, hole[0].y);
      for (let j = 1; j < hole.length; j++) path.lineTo(hole[j].x, hole[j].y);
      shape.holes.push(path);
    }

    let geo: THREE.ShapeGeometry;
    try {
      geo = new THREE.ShapeGeometry(shape);
    } catch {
      return; // triangulation failed
    }

    // Set floor/ceiling texture UVs (tile at 64x64)
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uvAttr.count; i++) {
      // Shape is in DOOM XY, so position x = DOOM X, y = DOOM Y
      uvAttr.setXY(i, posAttr.getX(i) / 64, posAttr.getY(i) / 64);
    }

    // Rotate from XY to XZ plane: (x, y, 0) → (x, 0, -y)
    geo.rotateX(-Math.PI / 2);

    const light = sec.light ?? 160;

    // Floor
    const floorMat = makeMaterial(sec.floorTex || 'FLOOR4_8', light);
    const floorMesh = new THREE.Mesh(geo, floorMat);
    floorMesh.position.y = sec.floor ?? 0;
    floorMesh.userData = { entityType: 'sector', entityId: sid, surface: 'floor' };
    group.add(floorMesh);

    // Ceiling (reverse winding so normals face downward)
    const ceilGeo = geo.clone();
    const ceilIndex = ceilGeo.getIndex();
    if (ceilIndex) {
      const arr = ceilIndex.array as Uint16Array | Uint32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      ceilIndex.needsUpdate = true;
    }
    const ceilMat = makeMaterial(sec.ceilTex || 'CEIL3_5', light);
    const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
    ceilMesh.position.y = sec.ceiling ?? 128;
    ceilMesh.userData = { entityType: 'sector', entityId: sid, surface: 'ceiling' };
    group.add(ceilMesh);
  });
}

// ── Half-sectors (floor-only or ceiling-only surfaces) ──

export function buildHalfSectors(group: THREE.Group): void {
  maps.halfSectors.forEach((hs, hid) => {
    const outline = hs.outline;
    if (!outline || outline.length < 3) return;

    // Three.js Shape expects CCW for the outer boundary so normals come out right.
    const ccw = signedArea2(outline) > 0 ? outline : [...outline].reverse();

    const shape = new THREE.Shape();
    shape.moveTo(ccw[0].x, ccw[0].y);
    for (let i = 1; i < ccw.length; i++) shape.lineTo(ccw[i].x, ccw[i].y);

    let geo: THREE.ShapeGeometry;
    try { geo = new THREE.ShapeGeometry(shape); }
    catch { return; }

    // Tile UVs at 64x64 like sector floors/ceilings
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setXY(i, posAttr.getX(i) / 64, posAttr.getY(i) / 64);
    }

    geo.rotateX(-Math.PI / 2);

    const light = hs.light ?? 160;

    if (hs.type === 'floor') {
      const mat = makeMaterial(hs.tex || 'FLOOR4_8', light);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = hs.height ?? 0;
      mesh.userData = { entityType: 'halfSector', entityId: hid, surface: 'floor' };
      group.add(mesh);
    } else {
      // Ceiling: flip winding so normal faces downward
      const idx = geo.getIndex();
      if (idx) {
        const arr = idx.array as Uint16Array | Uint32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const tmp = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = tmp;
        }
        idx.needsUpdate = true;
      }
      const mat = makeMaterial(hs.tex || 'CEIL3_5', light);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = hs.height ?? 128;
      mesh.userData = { entityType: 'halfSector', entityId: hid, surface: 'ceiling' };
      group.add(mesh);
    }
  });
}

// ── Walls ──

function makeWallQuad(
  x1: number, y1: number, x2: number, y2: number,
  bottom: number, top: number,
  texName: string, light: number,
  xoff: number, yoff: number,
  entityId: string, sidedefId: string, surface: string, group: THREE.Group
): void {
  if (top <= bottom) return;

  const wallLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (wallLen < 0.01) return;
  const wallH = top - bottom;

  const { w: tw, h: th } = getTexSize(texName);

  // Three coords: (doomX, height, -doomY)
  const positions = new Float32Array([
    x1, bottom, -y1,
    x2, bottom, -y2,
    x2, top, -y2,
    x1, top, -y1,
  ]);

  const u0 = xoff / tw;
  const u1 = (xoff + wallLen) / tw;
  const v0 = 1 - (yoff + wallH) / th;
  const v1 = 1 - yoff / th;

  const uvs = new Float32Array([
    u0, v0,
    u1, v0,
    u1, v1,
    u0, v1,
  ]);

  const indices = [0, 1, 2, 0, 2, 3];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = makeMaterial(texName, light);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = { entityType: 'linedef', entityId, sidedefId, surface };
  group.add(mesh);
}

function makeMidWallQuad(
  x1: number, y1: number, x2: number, y2: number,
  openBottom: number, openTop: number,
  texName: string, light: number,
  xoff: number, yoff: number, flags: number,
  entityId: string, sidedefId: string, surface: string, group: THREE.Group
): void {
  if (openTop <= openBottom) return;

  const wallLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (wallLen < 0.01) return;

  const { w: tw, h: th } = getTexSize(texName);
  const lowerUnpeg = !!(flags & 0x10);

  // Position the texture within the opening
  let texTop: number, texBottom: number;
  if (lowerUnpeg) {
    // Texture anchored to bottom of opening
    texBottom = openBottom + yoff;
    texTop = texBottom + th;
  } else {
    // Texture anchored to top of opening
    texTop = openTop + yoff;
    texBottom = texTop - th;
  }

  // Clip to the opening (mid textures don't tile vertically)
  const drawBottom = Math.max(openBottom, texBottom);
  const drawTop = Math.min(openTop, texTop);
  if (drawTop <= drawBottom) return;

  const positions = new Float32Array([
    x1, drawBottom, -y1,
    x2, drawBottom, -y2,
    x2, drawTop, -y2,
    x1, drawTop, -y1,
  ]);

  const u0 = xoff / tw;
  const u1 = (xoff + wallLen) / tw;
  // V coords: flip for Three.js (v=1 is image top, v=0 is image bottom)
  const vTop = 1 - (texTop - drawTop) / th;
  const vBottom = 1 - (texTop - drawBottom) / th;

  const uvs = new Float32Array([
    u0, vBottom,
    u1, vBottom,
    u1, vTop,
    u0, vTop,
  ]);

  const indices = [0, 1, 2, 0, 2, 3];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = makeMaterial(texName, light, true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = { entityType: 'linedef', entityId, sidedefId, surface };
  group.add(mesh);
}

export function buildWalls(group: THREE.Group): void {
  maps.linedefs.forEach((ld, lid) => {
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) return;

    const frontSd = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
    const backSd = ld.backSide ? maps.sidedefs.get(ld.backSide) : null;
    const frontSec = frontSd?.sector ? maps.sectors.get(frontSd.sector) : null;
    const backSec = backSd?.sector ? maps.sectors.get(backSd.sector) : null;

    if (!frontSec && !backSec) return;

    const upperUnpeg = !!(ld.flags & 0x08);
    const lowerUnpeg = !!(ld.flags & 0x10);

    if (!frontSec) {
      // Back-only single-sided: render wall from back side (flipped winding)
      const bFloor = backSec!.floor ?? 0;
      const bCeil = backSec!.ceiling ?? 128;
      const bLight = backSec!.light ?? 160;
      const texName = backSd?.mid || 'STARTAN2';
      const yoff = backSd?.yoff ?? 0;
      const wallH = bCeil - bFloor;
      const adjYoff = lowerUnpeg ? yoff + getTexSize(texName).h - wallH : yoff;
      makeWallQuad(v2.x, v2.y, v1.x, v1.y, bFloor, bCeil,
        texName, bLight, backSd?.xoff ?? 0, adjYoff, lid, ld.backSide!, 'mid', group);
      return;
    }

    const fFloor = frontSec.floor ?? 0;
    const fCeil = frontSec.ceiling ?? 128;
    const fLight = frontSec.light ?? 160;

    if (!backSec) {
      // Front-only single-sided: full wall
      // Default: top-aligned; lower unpegged: bottom-aligned
      const texName = frontSd?.mid || 'STARTAN2';
      const yoff = frontSd?.yoff ?? 0;
      const wallH = fCeil - fFloor;
      const adjYoff = lowerUnpeg ? yoff + getTexSize(texName).h - wallH : yoff;
      makeWallQuad(v1.x, v1.y, v2.x, v2.y, fFloor, fCeil,
        texName, fLight, frontSd?.xoff ?? 0, adjYoff, lid, ld.frontSide!, 'mid', group);
    } else {
      const bFloor = backSec.floor ?? 0;
      const bCeil = backSec.ceiling ?? 128;
      const bLight = backSec.light ?? 160;

      // Upper wall (front side)
      // Default: bottom-aligned (bottom of texture at lower ceiling); upper unpegged: top-aligned
      if (fCeil > bCeil && frontSd) {
        const texName = frontSd.upper || 'STARTAN2';
        const yoff = frontSd.yoff ?? 0;
        const wallH = fCeil - bCeil;
        const adjYoff = upperUnpeg ? yoff : yoff + getTexSize(texName).h - wallH;
        makeWallQuad(v1.x, v1.y, v2.x, v2.y, bCeil, fCeil,
          texName, fLight, frontSd.xoff ?? 0, adjYoff, lid, ld.frontSide!, 'upper', group);
      }
      // Lower wall (front side)
      // Default: top-aligned; lower unpegged: aligned to front sector ceiling
      if (bFloor > fFloor && frontSd) {
        const texName = frontSd.lower || 'STARTAN2';
        const yoff = frontSd.yoff ?? 0;
        const adjYoff = lowerUnpeg ? yoff + fCeil - bFloor : yoff;
        makeWallQuad(v1.x, v1.y, v2.x, v2.y, fFloor, bFloor,
          texName, fLight, frontSd.xoff ?? 0, adjYoff, lid, ld.frontSide!, 'lower', group);
      }

      // Upper wall (back side)
      if (bCeil > fCeil && backSd) {
        const texName = backSd.upper || 'STARTAN2';
        const yoff = backSd.yoff ?? 0;
        const wallH = bCeil - fCeil;
        const adjYoff = upperUnpeg ? yoff : yoff + getTexSize(texName).h - wallH;
        makeWallQuad(v2.x, v2.y, v1.x, v1.y, fCeil, bCeil,
          texName, bLight, backSd.xoff ?? 0, adjYoff, lid, ld.backSide!, 'upper', group);
      }
      // Lower wall (back side)
      if (fFloor > bFloor && backSd) {
        const texName = backSd.lower || 'STARTAN2';
        const yoff = backSd.yoff ?? 0;
        const adjYoff = lowerUnpeg ? yoff + bCeil - fFloor : yoff;
        makeWallQuad(v2.x, v2.y, v1.x, v1.y, bFloor, fFloor,
          texName, bLight, backSd.xoff ?? 0, adjYoff, lid, ld.backSide!, 'lower', group);
      }

      // Mid texture (front side) — gates, grates, fences
      if (frontSd && frontSd.mid && frontSd.mid !== '-') {
        const openBottom = Math.max(fFloor, bFloor);
        const openTop = Math.min(fCeil, bCeil);
        makeMidWallQuad(v1.x, v1.y, v2.x, v2.y, openBottom, openTop,
          frontSd.mid, fLight, frontSd.xoff ?? 0, frontSd.yoff ?? 0,
          ld.flags, lid, ld.frontSide!, 'mid', group);
      }
      // Mid texture (back side)
      if (backSd && backSd.mid && backSd.mid !== '-') {
        const openBottom = Math.max(fFloor, bFloor);
        const openTop = Math.min(fCeil, bCeil);
        makeMidWallQuad(v2.x, v2.y, v1.x, v1.y, openBottom, openTop,
          backSd.mid, bLight, backSd.xoff ?? 0, backSd.yoff ?? 0,
          ld.flags, lid, ld.backSide!, 'mid', group);
      }
    }
  });
}

// ── Things ──

function thingFloorHeight(wx: number, wy: number): number {
  let floorH = 0;
  maps.sectors.forEach((sec, sid) => {
    if (pointInSector(wx, wy, sid)) {
      floorH = sec.floor ?? 0;
    }
  });
  return floorH;
}

function thingCeilHeight(wx: number, wy: number): number {
  let ceilH = 128;
  maps.sectors.forEach((sec, sid) => {
    if (pointInSector(wx, wy, sid)) {
      ceilH = sec.ceiling ?? 128;
    }
  });
  return ceilH;
}

export function buildThings(group: THREE.Group): void {
  const spriteTexCache = new Map<string, THREE.Texture>();

  maps.things.forEach((thing, tid) => {
    const info = THINGS[thing.type];
    const cat = info?.cat || 'player';
    const radius = info?.radius || 16;
    const color = CAT_COLOR[cat] || '#fff';
    const isCeiling = info?.ceiling ?? false;
    const floorH = thingFloorHeight(thing.x, thing.y);
    const ceilH = isCeiling ? thingCeilHeight(thing.x, thing.y) : 0;

    // Try sprite
    const spritePrefix = THING_SPRITE[thing.type];
    const sprite = spritePrefix ? getSpritePrefixEntry(spritePrefix) : null;

    let mesh: THREE.Mesh;

    if (sprite) {
      const w = sprite.width;
      const h = sprite.height;

      let spriteTop: number, spriteBottom: number, visibleH: number;

      if (isCeiling) {
        // Ceiling-hung: sprite top anchored at ceiling
        spriteTop = ceilH - 0.1;
        const rawBottom = spriteTop - h;
        spriteBottom = Math.max(rawBottom, floorH);
        visibleH = spriteTop - spriteBottom;
      } else {
        // Floor-standing: bottom of sprite sits on the floor
        spriteBottom = floorH;
        spriteTop = floorH + h;
        visibleH = h;
      }
      if (visibleH <= 0) return;

      const geo = new THREE.PlaneGeometry(w, visibleH);

      // Crop texture if sprite is clipped by floor/ceiling
      if (visibleH < h) {
        const cropFrac = (h - visibleH) / h;
        const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
        if (isCeiling) {
          // Crop top of texture (sprite hangs from ceiling, bottom clipped by floor)
          for (let i = 0; i < uvAttr.count; i++) {
            const v = uvAttr.getY(i);
            uvAttr.setY(i, v * (1 - cropFrac));
          }
        } else {
          // Crop bottom of texture (sprite stands on floor, bottom clipped)
          for (let i = 0; i < uvAttr.count; i++) {
            const v = uvAttr.getY(i);
            uvAttr.setY(i, cropFrac + v * (1 - cropFrac));
          }
        }
      }

      let tex = spriteTexCache.get(sprite.name);
      if (!tex) {
        const img = new Image();
        img.src = sprite.dataUrl;
        tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        img.onload = () => { tex!.needsUpdate = true; };
        if (img.complete) tex.needsUpdate = true;
        spriteTexCache.set(sprite.name, tex);
      }

      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        color: new THREE.Color(BRIGHTNESS_SCALE, BRIGHTNESS_SCALE, BRIGHTNESS_SCALE),
      });

      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(thing.x, spriteBottom + visibleH / 2, -thing.y);
    } else {
      // Colored marker billboard
      const h = radius * 2;
      const w = radius;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      mesh = new THREE.Mesh(geo, mat);
      if (isCeiling) {
        mesh.position.set(thing.x, ceilH - h / 2, -thing.y);
      } else {
        mesh.position.set(thing.x, floorH + h / 2, -thing.y);
      }
    }

    mesh.userData = { entityType: 'thing', entityId: tid, billboard: true };
    group.add(mesh);
  });
}

export function clearTexCache(): void {
  texCache.forEach(t => t.dispose());
  texCache.clear();
}
