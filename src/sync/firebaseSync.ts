import { db, mapRef } from '../config/firebase';
import { uid, maps, selected, setSelected, setSnapSize, setGameType, triggerDraw, triggerRenderPanel } from '../state/appState';
import { onLinedefAdded, onLinedefChanged, onLinedefRemoved, onSidedefAdded, onSidedefChanged, onSidedefRemoved } from '../state/indices';
import { loadTexturesFromDb } from '../wad/textureLoader';
import { updateToolbarButton } from '../ui/thingBrowser';
import type { MapCollection } from '../types';

function colToType(col: string): string { return col.replace(/s$/, ''); }

function syncCollection(col: MapCollection): void {
  const ref = mapRef(col as string);
  ref.on('child_added',   (s: FirebaseSnapshot) => {
    maps[col].set(s.key, s.val());
    if (col === 'linedefs') {
      const val = s.val();
      onLinedefAdded(s.key, val.v1, val.v2);
    } else if (col === 'sidedefs') {
      const val = s.val();
      onSidedefAdded(s.key, val.sector);
    }
    triggerDraw();
  });
  ref.on('child_changed', (s: FirebaseSnapshot) => {
    const oldLd = col === 'linedefs' ? maps.linedefs.get(s.key) : undefined;
    const oldSd = col === 'sidedefs' ? maps.sidedefs.get(s.key) : undefined;
    maps[col].set(s.key, s.val());
    if (col === 'linedefs' && oldLd) {
      const val = s.val();
      onLinedefChanged(s.key, val.v1, val.v2, oldLd.v1, oldLd.v2);
    } else if (col === 'sidedefs') {
      const val = s.val();
      onSidedefChanged(s.key, val.sector, oldSd?.sector);
    }
    triggerDraw();
    if (selected && selected.type === colToType(col) && selected.id === s.key) {
      triggerRenderPanel();
    } else if (col === 'sidedefs' && selected?.type === 'linedef') {
      const ld = maps.linedefs.get(selected.id);
      if (ld && (ld.frontSide === s.key || ld.backSide === s.key)) triggerRenderPanel();
    }
  });
  ref.on('child_removed', (s: FirebaseSnapshot) => {
    if (col === 'linedefs') {
      const old = maps.linedefs.get(s.key);
      if (old) onLinedefRemoved(s.key, old.v1, old.v2);
    } else if (col === 'sidedefs') {
      const old = maps.sidedefs.get(s.key);
      if (old) onSidedefRemoved(s.key, old.sector);
    }
    maps[col].delete(s.key);
    if (selected && selected.type === colToType(col) && selected.id === s.key) {
      setSelected(null); triggerRenderPanel();
    }
    triggerDraw();
  });
}

export function initSync(): void {
  (['vertices','linedefs','sidedefs','sectors','things'] as const).forEach(syncCollection);

  db.ref('settings/snapSize').on('value', (s: FirebaseSnapshot) => {
    const val = s.val();
    if (val != null) {
      setSnapSize(val);
      const sel = document.getElementById('snap-size-sel') as HTMLSelectElement | null;
      if (sel) sel.value = String(val);
      triggerDraw();
    }
  });

  db.ref('map/gameType').on('value', (s: FirebaseSnapshot) => {
    const val = s.val();
    if (val === 'doom1' || val === 'doom2') setGameType(val);
  });

  // Load persisted IWAD textures
  loadTexturesFromDb().then(updateToolbarButton);
}

export function initPresence(): void {
  const presRef = db.ref('presence/' + uid);
  presRef.set(true);
  presRef.onDisconnect().remove();

  db.ref('presence').on('value', (snap: FirebaseSnapshot) => {
    const n = snap.numChildren();
    document.getElementById('users')!.textContent = n + (n === 1 ? ' user' : ' users');
  });

  db.ref('.info/connected').on('value', (snap: FirebaseSnapshot) => {
    const el = document.getElementById('status')!;
    el.textContent = snap.val() ? 'Connected' : 'Offline';
    el.className   = snap.val() ? 'connected'  : 'disconnected';
  });
}
