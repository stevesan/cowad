import './styles/main.css';
import './config/firebase';
import { db, mapRef, ready, firebaseAvailable, isConnected, connectFirebase, disconnectFirebase } from './config/firebase';
import { pan, setCallbacks } from './state/appState';
import { initRenderer, draw, zoomToFit } from './canvas/renderer';
import { renderPanel } from './ui/propertiesPanel';
import { initCanvasInput, initKeyboard } from './ui/canvasInput';
import { initToolbar } from './ui/toolbar';
import { initSync, initPresence } from './sync/firebaseSync';
import { rebuild3D } from './3d/view3d';
import { initDropImport } from './export/jsonExport';

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

initDropImport();

// --- Connection UI ---
const statusEl = document.getElementById('status')!;
const usersEl = document.getElementById('users')!;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement | null;

if (isConnected) {
  initPresence();
  if (connectBtn) {
    connectBtn.textContent = 'Disconnect';
    connectBtn.style.display = '';
    connectBtn.addEventListener('click', disconnectFirebase);
  }
} else {
  statusEl.textContent = 'Local';
  statusEl.className = 'connected';
  usersEl.textContent = '';
  if (firebaseAvailable && connectBtn) {
    connectBtn.textContent = 'Connect';
    connectBtn.style.display = '';
    connectBtn.addEventListener('click', connectFirebase);
  }
}

resize();
pan.x = canvas.width  / 2;
pan.y = canvas.height / 2;
draw();

// Wait for IndexedDB to load (instant for Firebase mode), then start syncing
ready.then(() => {
  initSync();
  mapRef('vertices').once('value').then(() => {
    setTimeout(zoomToFit, 100);
  });
});
