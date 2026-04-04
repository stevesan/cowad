import './styles/main.css';
import './config/firebase';
import { db, mapRef, ready, isConnected, connectFirebase, disconnectFirebase, hasFirebaseConfig, getFirebaseConfig, saveFirebaseConfig } from './config/firebase';
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

// --- Firebase config dialog ---

function showFirebaseDialog(andConnect: boolean): void {
  const fields = [
    { key: 'apiKey', label: 'API Key' },
    { key: 'authDomain', label: 'Auth Domain' },
    { key: 'databaseURL', label: 'Database URL' },
    { key: 'projectId', label: 'Project ID' },
    { key: 'storageBucket', label: 'Storage Bucket' },
    { key: 'messagingSenderId', label: 'Messaging Sender ID' },
    { key: 'appId', label: 'App ID' },
  ];

  const existing = getFirebaseConfig() as Record<string, string> | null;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a1a;border:1px solid #444;border-radius:6px;padding:16px;width:420px;font-family:monospace;';
  box.innerHTML = '<div style="color:#ccc;font-size:14px;margin-bottom:12px;">Firebase Configuration</div>' +
    '<div style="color:#888;font-size:11px;margin-bottom:12px;">Find these values in Firebase Console \u2192 Project Settings</div>';

  const inputs: Record<string, HTMLInputElement> = {};
  for (const f of fields) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;';
    row.innerHTML = `<label style="color:#888;font-size:11px;display:block;margin-bottom:2px;">${f.label}</label>`;
    const input = document.createElement('input');
    input.style.cssText = 'width:100%;box-sizing:border-box;background:#111;color:#ccc;border:1px solid #333;border-radius:3px;padding:4px 6px;font-family:monospace;font-size:12px;';
    input.placeholder = f.key;
    if (existing?.[f.key]) input.value = existing[f.key];
    inputs[f.key] = input;
    row.appendChild(input);
    box.appendChild(row);
  }

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#2a1a1a;border:1px solid #644;color:#f88;padding:4px 12px;cursor:pointer;border-radius:3px;font-size:12px;font-family:monospace;';
  cancelBtn.onclick = () => overlay.remove();

  const saveBtn = document.createElement('button');
  saveBtn.textContent = andConnect ? 'Connect' : 'Save';
  saveBtn.style.cssText = 'background:#1a2a1a;border:1px solid #464;color:#8f8;padding:4px 12px;cursor:pointer;border-radius:3px;font-size:12px;font-family:monospace;';
  saveBtn.onclick = () => {
    const config: Record<string, string> = {};
    for (const f of fields) {
      const val = inputs[f.key].value.trim();
      if (!val) { inputs[f.key].style.borderColor = '#f44'; return; }
      config[f.key] = val;
    }
    saveFirebaseConfig(config as any);
    if (andConnect) {
      connectFirebase();
    } else {
      overlay.remove();
    }
  };

  btnRow.append(cancelBtn, saveBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  inputs['apiKey'].focus();
}

// --- Connection UI ---
const statusEl = document.getElementById('status')!;
const usersEl = document.getElementById('users')!;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;

const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
settingsBtn.style.display = '';
settingsBtn.addEventListener('click', () => showFirebaseDialog(false));

if (isConnected) {
  initPresence();
  connectBtn.textContent = 'Disconnect';
  connectBtn.style.display = '';
  connectBtn.addEventListener('click', disconnectFirebase);
} else {
  statusEl.textContent = 'Local';
  statusEl.className = 'connected';
  usersEl.textContent = '';
  connectBtn.textContent = 'Connect';
  connectBtn.style.display = '';
  connectBtn.addEventListener('click', () => {
    if (hasFirebaseConfig()) {
      connectFirebase();
    } else {
      showFirebaseDialog(true);
    }
  });
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
