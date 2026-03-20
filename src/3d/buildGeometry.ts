import * as THREE from 'three';
import { maps } from '../state/appState';
import { buildSectorPolys } from '../geometry/cycleFinder';
import { getTextureDataUrl, isWadLoaded, getTextures } from '../wad/textureLoader';

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

function makeMaterial(texName: string, light: number): THREE.MeshBasicMaterial {
  const brightness = Math.max(0.05, Math.min(1, light / 255)) * BRIGHTNESS_SCALE;
  const tex = getTexture(texName);
  if (tex) {
    return new THREE.MeshBasicMaterial({
      map: tex.clone(),
      color: new THREE.Color(brightness, brightness, brightness),
      side: THREE.DoubleSide,
    });
  }
  const c = Math.round(brightness * 180);
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(`rgb(${c},${c},${Math.round(c * 0.75)})`),
    side: THREE.DoubleSide,
  });
}

// ── Floors & Ceilings ──

function signedArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

export function buildFloorsCeilings(group: THREE.Group): void {
  maps.sectors.forEach((sec, sid) => {
    const loops = buildSectorPolys(sid);
    if (!loops.length) return;

    // Find outer boundary (largest absolute area)
    let outerIdx = 0;
    let maxArea = 0;
    for (let i = 0; i < loops.length; i++) {
      const a = Math.abs(signedArea(loops[i]));
      if (a > maxArea) { maxArea = a; outerIdx = i; }
    }

    const outerPts = loops[outerIdx];
    // Ensure CCW for outer boundary
    const outerArea = signedArea(outerPts);
    const outer = outerArea < 0 ? [...outerPts].reverse() : outerPts;

    const shape = new THREE.Shape();
    shape.moveTo(outer[0].x, outer[0].y);
    for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);

    // Add holes
    for (let i = 0; i < loops.length; i++) {
      if (i === outerIdx) continue;
      const holePts = loops[i];
      const holeArea = signedArea(holePts);
      // Holes should be CW (negative area)
      const hole = holeArea > 0 ? [...holePts].reverse() : holePts;
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

    // Ceiling
    const ceilGeo = geo.clone();
    const ceilMat = makeMaterial(sec.ceilTex || 'CEIL3_5', light);
    const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
    ceilMesh.position.y = sec.ceiling ?? 128;
    ceilMesh.userData = { entityType: 'sector', entityId: sid, surface: 'ceiling' };
    group.add(ceilMesh);
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
  const v0 = (yoff + wallH) / th;
  const v1 = yoff / th;

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

export function buildWalls(group: THREE.Group): void {
  maps.linedefs.forEach((ld, lid) => {
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) return;

    const frontSd = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
    const backSd = ld.backSide ? maps.sidedefs.get(ld.backSide) : null;
    const frontSec = frontSd?.sector ? maps.sectors.get(frontSd.sector) : null;
    const backSec = backSd?.sector ? maps.sectors.get(backSd.sector) : null;

    if (!frontSec) return;

    const fFloor = frontSec.floor ?? 0;
    const fCeil = frontSec.ceiling ?? 128;
    const fLight = frontSec.light ?? 160;

    if (!backSec) {
      // Single-sided: full wall
      const texName = frontSd?.mid || 'STARTAN2';
      makeWallQuad(v1.x, v1.y, v2.x, v2.y, fFloor, fCeil,
        texName, fLight, frontSd?.xoff ?? 0, frontSd?.yoff ?? 0, lid, ld.frontSide!, 'mid', group);
    } else {
      const bFloor = backSec.floor ?? 0;
      const bCeil = backSec.ceiling ?? 128;
      const bLight = backSec.light ?? 160;

      // Upper wall (front side)
      if (fCeil > bCeil && frontSd) {
        makeWallQuad(v1.x, v1.y, v2.x, v2.y, bCeil, fCeil,
          frontSd.upper || 'STARTAN2', fLight, frontSd.xoff ?? 0, frontSd.yoff ?? 0, lid, ld.frontSide!, 'upper', group);
      }
      // Lower wall (front side)
      if (bFloor > fFloor && frontSd) {
        makeWallQuad(v1.x, v1.y, v2.x, v2.y, fFloor, bFloor,
          frontSd.lower || 'STARTAN2', fLight, frontSd.xoff ?? 0, frontSd.yoff ?? 0, lid, ld.frontSide!, 'lower', group);
      }

      // Upper wall (back side)
      if (bCeil > fCeil && backSd) {
        makeWallQuad(v2.x, v2.y, v1.x, v1.y, fCeil, bCeil,
          backSd.upper || 'STARTAN2', bLight, backSd.xoff ?? 0, backSd.yoff ?? 0, lid, ld.backSide!, 'upper', group);
      }
      // Lower wall (back side)
      if (fFloor > bFloor && backSd) {
        makeWallQuad(v2.x, v2.y, v1.x, v1.y, bFloor, fFloor,
          backSd.lower || 'STARTAN2', bLight, backSd.xoff ?? 0, backSd.yoff ?? 0, lid, ld.backSide!, 'lower', group);
      }
    }
  });
}

export function clearTexCache(): void {
  texCache.forEach(t => t.dispose());
  texCache.clear();
}
