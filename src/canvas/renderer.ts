import { maps, selected, hovered, tool, mouseWorld, zoom, drawPoints, multiSelected, multiSelectType, boxSelectStart } from '../state/appState';
import { THINGS, THING_SPRITE } from '../config/constants';
import { w2s, s2w, snap } from './transforms';
import { getSpritePrefixEntry, isWadLoaded } from '../wad/textureLoader';
import { buildSectorPoly, buildSectorPolys } from '../geometry/cycleFinder';
import { nearestVertex } from '../geometry/hitTest';
import { VERTEX_PICK_PX, GRID, CAT_COLOR } from '../config/ux';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

export function initRenderer(c: HTMLCanvasElement): void {
  canvas = c;
  ctx = canvas.getContext('2d')!;
}

export function getCanvas(): HTMLCanvasElement { return canvas; }

export function draw(): void {
  if (!canvas) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  drawGrid(W, H);
  drawSectors();
  drawLinedefs();
  drawVertices();
  drawThings();
  drawPolygonPreview();
  drawBoxSelect();
}

function drawGrid(W: number, H: number): void {
  const tl = s2w(0, 0), br = s2w(W, H);
  const x0 = Math.floor(tl.x / GRID) * GRID;
  const x1 = Math.ceil(br.x / GRID)  * GRID;
  const y0 = Math.floor(br.y / GRID) * GRID;
  const y1 = Math.ceil(tl.y / GRID)  * GRID;
  ctx.strokeStyle = '#181818';
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += GRID) {
    const sx = w2s(x, 0).x;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let y = y0; y <= y1; y += GRID) {
    const sy = w2s(0, y).y;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }
  ctx.strokeStyle = '#252525';
  const o = w2s(0, 0);
  ctx.beginPath(); ctx.moveTo(o.x, 0); ctx.lineTo(o.x, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, o.y); ctx.lineTo(W, o.y); ctx.stroke();
}

function drawSectors(): void {
  maps.sectors.forEach((sec, sid) => {
    const loops = buildSectorPolys(sid);
    if (!loops.length) return;
    const isSel = selected && selected.type === 'sector' && selected.id === sid;
    const isMultiSel = multiSelectType === 'sector' && multiSelected.has(sid);
    const isHov = hovered  && hovered.type  === 'sector' && hovered.id  === sid;
    const light = Math.max(0, Math.min(255, sec.light ?? 160));
    const c = Math.round(20 + (light / 255) * 70);
    ctx.fillStyle = (isSel || isMultiSel)
      ? `rgba(${c + 40},${c + 30},${Math.round(c * 0.4)},0.7)`
      : isHov
      ? `rgba(${c + 20},${c + 20},${Math.round(c * 0.75) + 15},0.7)`
      : `rgba(${c},${c},${Math.round(c * 0.75)},0.6)`;
    ctx.beginPath();
    for (const poly of loops) {
      const p0 = w2s(poly[0].x, poly[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < poly.length; i++) {
        const p = w2s(poly[i].x, poly[i].y); ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    if (isSel || isMultiSel) { ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2; ctx.stroke(); }
    else if (isHov) { ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.lineWidth = 1; ctx.stroke(); }
  });
}

function drawLinedefs(): void {
  maps.linedefs.forEach((ld, lid) => {
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) return;
    const s1 = w2s(v1.x, v1.y), s2 = w2s(v2.x, v2.y);
    const isSel   = selected && selected.type === 'linedef' && selected.id === lid;
    const isMultiSel = multiSelectType === 'linedef' && multiSelected.has(lid);
    const isHov   = hovered  && hovered.type  === 'linedef' && hovered.id  === lid;
    const twoSide = !!(ld.flags & 4);
    if (isHov && !isSel && !isMultiSel) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
    }
    ctx.strokeStyle = (isSel || isMultiSel) ? '#ff0' : isHov ? '#fff' : twoSide ? '#aa0' : '#ddd';
    ctx.lineWidth   = (isSel || isMultiSel) ? 2 : isHov ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
    const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2;
    const dx = s2.x - s1.x,        dy = s2.y - s1.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const nx = -dy / len, ny = dx / len;
      ctx.strokeStyle = '#f00';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + nx * 6, my + ny * 6);
      ctx.stroke();
    }
  });
}

function drawVertices(): void {
  maps.vertices.forEach((v, vid) => {
    const s     = w2s(v.x, v.y);
    const isSel = selected && selected.type === 'vertex' && selected.id === vid;
    const isMultiSel = multiSelected.has(vid);
    const isHov = hovered  && hovered.type  === 'vertex' && hovered.id  === vid;
    if (isHov && !isSel && !isMultiSel) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, VERTEX_PICK_PX, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = (isSel || isMultiSel) ? '#ff0' : isHov ? '#fff' : '#0ff';
    const sz = isHov || isSel || isMultiSel ? 4 : 3;
    ctx.fillRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
  });
}

const spriteImgCache = new Map<string, HTMLImageElement>();

function getSpriteImg(prefix: string): HTMLImageElement | null {
  if (spriteImgCache.has(prefix)) return spriteImgCache.get(prefix)!;
  const entry = getSpritePrefixEntry(prefix);
  if (!entry) return null;
  const img = new Image();
  img.src = entry.dataUrl;
  img.onload = () => draw();
  spriteImgCache.set(prefix, img);
  return img;
}

function drawThings(): void {
  maps.things.forEach((th, tid) => {
    const s    = w2s(th.x, th.y);
    const info = THINGS[th.type] || { r: 16, cat: 'player' };
    const r    = Math.max(info.r * zoom, 4);
    const boxSize = r * 2;
    const isSel = selected && selected.type === 'thing' && selected.id === tid;
    const isHov = hovered  && hovered.type  === 'thing' && hovered.id  === tid;
    const color = isSel ? '#ff0' : isHov ? '#fff' : (CAT_COLOR[info.cat] || '#fff');

    // Hover glow
    if (isHov && !isSel) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, Math.PI * 2); ctx.stroke();
    }

    // Sprite inside box
    const prefix = THING_SPRITE[th.type];
    const img = prefix && isWadLoaded() ? getSpriteImg(prefix) : null;
    if (img && img.complete && img.naturalWidth > 0) {
      const scale = Math.min(boxSize / img.naturalWidth, boxSize / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, s.x - dw / 2, s.y - dh / 2, dw, dh);
    }

    if (tool === 'thing' || isSel || isHov) {
      // Box outline at real radius
      ctx.strokeStyle = color;
      ctx.lineWidth = isSel ? 2 : isHov ? 2 : 1;
      ctx.strokeRect(s.x - r, s.y - r, boxSize, boxSize);

      // Angle indicator
      const ang = ((th.angle ?? 0) * Math.PI) / 180;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(ang) * r, s.y - Math.sin(ang) * r);
      ctx.stroke();
    }
  });
}

function drawPolygonPreview(): void {
  if (tool !== 'draw') return;

  // Show magnetic snap circle before first click
  if (drawPoints.length === 0) {
    const nearVid = nearestVertex(mouseWorld.x, mouseWorld.y, VERTEX_PICK_PX / zoom);
    if (nearVid) {
      const v = maps.vertices.get(nearVid)!;
      const s = w2s(v.x, v.y);
      ctx.strokeStyle = '#0ff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, VERTEX_PICK_PX, 0, Math.PI * 2); ctx.stroke();
    }
    return;
  }

  const first = drawPoints[0];
  const last = drawPoints[drawPoints.length - 1];

  // Compute snap target in world coords
  let targetX = snap(mouseWorld.x), targetY = snap(mouseWorld.y);
  const nearVid = nearestVertex(mouseWorld.x, mouseWorld.y, VERTEX_PICK_PX / zoom);
  let snappedToExisting = false;
  if (nearVid) {
    const v = maps.vertices.get(nearVid)!;
    targetX = v.x; targetY = v.y;
    snappedToExisting = true;
  }

  // Check close-at-start snap
  let closingAtStart = false;
  if (drawPoints.length >= 3) {
    const dist = Math.hypot(targetX - first.x, targetY - first.y);
    if (dist < 24 / zoom) {
      targetX = first.x; targetY = first.y;
      closingAtStart = true;
    }
  }

  // Semi-transparent polygon fill preview
  if (drawPoints.length >= 2) {
    ctx.fillStyle = 'rgba(0, 180, 0, 0.08)';
    ctx.beginPath();
    const p0 = w2s(first.x, first.y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < drawPoints.length; i++) {
      const p = w2s(drawPoints[i].x, drawPoints[i].y);
      ctx.lineTo(p.x, p.y);
    }
    const pT = w2s(targetX, targetY);
    ctx.lineTo(pT.x, pT.y);
    ctx.closePath();
    ctx.fill();
  }

  // Solid chain edges
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;
  for (let i = 0; i < drawPoints.length - 1; i++) {
    const s1 = w2s(drawPoints[i].x, drawPoints[i].y);
    const s2 = w2s(drawPoints[i + 1].x, drawPoints[i + 1].y);
    ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
  }

  // Dashed preview: last → target
  const sLast = w2s(last.x, last.y);
  const sTarget = w2s(targetX, targetY);
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(sLast.x, sLast.y); ctx.lineTo(sTarget.x, sTarget.y); ctx.stroke();

  // Dashed preview: target → first (closing edge)
  if (drawPoints.length >= 2) {
    const sFirst = w2s(first.x, first.y);
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
    ctx.beginPath(); ctx.moveTo(sTarget.x, sTarget.y); ctx.lineTo(sFirst.x, sFirst.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Chain vertex markers
  for (let i = 0; i < drawPoints.length; i++) {
    const s = w2s(drawPoints[i].x, drawPoints[i].y);
    ctx.fillStyle = i === 0 ? '#0f0' : '#0ff';
    const sz = i === 0 ? 5 : 3;
    ctx.fillRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
  }

  // Snap / close indicators
  if (closingAtStart) {
    const sFirst = w2s(first.x, first.y);
    ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
    ctx.beginPath(); ctx.arc(sFirst.x, sFirst.y, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sFirst.x, sFirst.y, 30, 0, Math.PI * 2); ctx.stroke();
  } else if (snappedToExisting) {
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sTarget.x, sTarget.y, VERTEX_PICK_PX, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawBoxSelect(): void {
  if (!boxSelectStart) return;
  const s1 = w2s(boxSelectStart.x, boxSelectStart.y);
  const s2 = w2s(mouseWorld.x, mouseWorld.y);
  const x = Math.min(s1.x, s2.x), y = Math.min(s1.y, s2.y);
  const w = Math.abs(s2.x - s1.x), h = Math.abs(s2.y - s1.y);
  ctx.fillStyle = 'rgba(255, 255, 0, 0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}
