import './styles/main.css';
import './config/firebase.js';
import { pan, setCallbacks } from './state/appState.js';
import { initRenderer, draw, getCanvas } from './canvas/renderer.js';
import { renderPanel } from './ui/propertiesPanel.js';
import { initCanvasInput, initKeyboard } from './ui/canvasInput.js';
import { initToolbar } from './ui/toolbar.js';
import { initSync, initPresence } from './sync/firebaseSync.js';

// Wire up callbacks to break circular deps
setCallbacks({ draw, renderPanel });

// Canvas setup
const canvas = document.getElementById('canvas');
initRenderer(canvas);

function resize() {
  const wrap = document.getElementById('canvas-wrap');
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  draw();
}
window.addEventListener('resize', resize);

// Input handlers
initCanvasInput(canvas);
const doSetTool = initKeyboard(canvas);
initToolbar(doSetTool);

// Firebase sync
initSync();
initPresence();

// Initial layout
resize();
pan.x = canvas.width  / 2;
pan.y = canvas.height / 2;
draw();
