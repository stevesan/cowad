import './styles/main.css';
import './config/firebase';
import { db, mapRef } from './config/firebase';
import { maps, pan, zoom, setZoom, setCallbacks } from './state/appState';
import { initRenderer, draw } from './canvas/renderer';
import { renderPanel } from './ui/propertiesPanel';
import { initCanvasInput, initKeyboard } from './ui/canvasInput';
import { initToolbar } from './ui/toolbar';
import { initSync, initPresence } from './sync/firebaseSync';
import { rebuild3D } from './3d/view3d';

setCallbacks({ draw, renderPanel, rebuild3D });

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
initRenderer(canvas);

function resize(): void {
  const wrap = document.getElementById('canvas-wrap')!;
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  draw();
}
window.addEventListener('resize', resize);

initCanvasInput(canvas);
const doSetTool = initKeyboard(canvas);
initToolbar(doSetTool);

document.getElementById('snap-size-sel')!.addEventListener('change', e => {
  const val = parseInt((e.target as HTMLSelectElement).value, 10);
  db.ref('settings/snapSize').set(val);
});

initSync();
initPresence();

resize();
pan.x = canvas.width  / 2;
pan.y = canvas.height / 2;
draw();

// After initial data loads, zoom to fit all geometry
mapRef('vertices').once('value', () => {
  setTimeout(() => {
    if (maps.vertices.size === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    maps.vertices.forEach(v => {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    });
    const padding = 80;
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const fitZoom = Math.min((canvas.width - padding * 2) / w, (canvas.height - padding * 2) / h);
    setZoom(Math.max(0.05, Math.min(32, fitZoom)));
    pan.x = canvas.width / 2 - cx * zoom;
    pan.y = canvas.height / 2 + cy * zoom;
    draw();
  }, 100);
});
