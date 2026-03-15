import { db, mapRef } from '../config/firebase.js';
import { uid, maps, selected, setSelected, triggerDraw, triggerRenderPanel } from '../state/appState.js';

function colToType(col) { return col.replace(/s$/, ''); }

function syncCollection(col) {
  const ref = mapRef(col);
  ref.on('child_added',   s => { maps[col].set(s.key, s.val()); triggerDraw(); });
  ref.on('child_changed', s => {
    maps[col].set(s.key, s.val());
    triggerDraw();
    if (selected && selected.type === colToType(col) && selected.id === s.key) triggerRenderPanel();
  });
  ref.on('child_removed', s => {
    maps[col].delete(s.key);
    if (selected && selected.type === colToType(col) && selected.id === s.key) {
      setSelected(null); triggerRenderPanel();
    }
    triggerDraw();
  });
}

export function initSync() {
  ['vertices','linedefs','sidedefs','sectors','things'].forEach(syncCollection);
}

export function initPresence() {
  const presRef = db.ref('presence/' + uid);
  presRef.set(true);
  presRef.onDisconnect().remove();

  db.ref('presence').on('value', snap => {
    const n = snap.numChildren();
    document.getElementById('users').textContent = n + (n === 1 ? ' user' : ' users');
  });

  db.ref('.info/connected').on('value', snap => {
    const el = document.getElementById('status');
    el.textContent = snap.val() ? 'Connected' : 'Offline';
    el.className   = snap.val() ? 'connected'  : 'disconnected';
  });
}
