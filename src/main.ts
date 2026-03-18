import './styles/main.css';
import './config/firebase';
import { db } from './config/firebase';
import { pan, setCallbacks, setSnapSize } from './state/appState';
import { initRenderer, draw } from './canvas/renderer';
import { renderPanel } from './ui/propertiesPanel';
import { initCanvasInput, initKeyboard } from './ui/canvasInput';
import { initToolbar } from './ui/toolbar';
import { initSync, initPresence } from './sync/firebaseSync';

setCallbacks({ draw, renderPanel });

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
