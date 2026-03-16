import { maps, selected, lineStart, tool, mouseWorld, zoom } from '../state/appState';
import { GRID, THINGS, CAT_COLOR } from '../config/constants';
import { w2s, s2w, snap } from './transforms';
import { buildSectorPoly } from '../geometry/cycleFinder';

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
  drawLinePreview();
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
    const poly = buildSectorPoly(sid);
    if (!poly || poly.length < 3) return;
    const isSel = selected && selected.type === 'sector' && selected.id === sid;
    const light = Math.max(0, Math.min(255, sec.light ?? 160));
    const c = Math.round(20 + (light / 255) * 70);
    ctx.fillStyle = `rgb(${c},${c},${Math.round(c * 0.75)})`;
    ctx.beginPath();
    const p0 = w2s(poly[0].x, poly[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < poly.length; i++) {
      const p = w2s(poly[i].x, poly[i].y); ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    if (isSel) { ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2; ctx.stroke(); }
  });
}

function drawLinedefs(): void {
  maps.linedefs.forEach((ld, lid) => {
    const v1 = maps.vertices.get(ld.v1);
    const v2 = maps.vertices.get(ld.v2);
    if (!v1 || !v2) return;
    const s1 = w2s(v1.x, v1.y), s2 = w2s(v2.x, v2.y);
    const isSel   = selected && selected.type === 'linedef' && selected.id === lid;
    const twoSide = !!(ld.flags & 4);
    ctx.strokeStyle = isSel ? '#ff0' : twoSide ? '#aa0' : '#ddd';
    ctx.lineWidth   = isSel ? 2 : 1;
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
    const isSel = selected   && selected.type   === 'vertex' && selected.id   === vid;
    const isLS  = lineStart !== null && lineStart === vid;
    ctx.fillStyle = isLS ? '#f00' : isSel ? '#ff0' : '#0ff';
    ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
  });
}

function drawThings(): void {
  maps.things.forEach((th, tid) => {
    const s    = w2s(th.x, th.y);
    const info = THINGS[th.type] || { r: 16, cat: 'player' };
    const r    = Math.max(info.r * zoom, 4);
    const isSel = selected && selected.type === 'thing' && selected.id === tid;
    ctx.strokeStyle = isSel ? '#ff0' : (CAT_COLOR[info.cat] || '#fff');
    ctx.lineWidth   = isSel ? 2 : 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
    const ang = ((th.angle ?? 0) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(ang) * r, s.y - Math.sin(ang) * r);
    ctx.stroke();
  });
}

function drawLinePreview(): void {
  if (tool !== 'line' || lineStart === null) return;
  const v = maps.vertices.get(lineStart);
  if (!v) return;
  const s1 = w2s(v.x, v.y);
  const s2 = w2s(snap(mouseWorld.x), snap(mouseWorld.y));
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
  ctx.setLineDash([]);
}
