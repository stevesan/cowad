import { db, mapRef } from '../config/firebase';
import { uid, maps, selected, setSelected, setSnapSize, triggerDraw, triggerRenderPanel } from '../state/appState';
import { loadTexturesFromDb } from '../wad/textureLoader';
import type { MapCollection } from '../types';

function colToType(col: string): string { return col.replace(/s$/, ''); }

function syncCollection(col: MapCollection): void {
  const ref = mapRef(col as string);
  ref.on('child_added',   (s: FirebaseSnapshot) => { maps[col].set(s.key, s.val()); triggerDraw(); });
  ref.on('child_changed', (s: FirebaseSnapshot) => {
    maps[col].set(s.key, s.val());
    triggerDraw();
    if (selected && selected.type === colToType(col) && selected.id === s.key) {
      triggerRenderPanel();
    } else if (col === 'sidedefs' && selected?.type === 'linedef') {
      const ld = maps.linedefs.get(selected.id);
      if (ld && (ld.frontSide === s.key || ld.backSide === s.key)) triggerRenderPanel();
    }
  });
  ref.on('child_removed', (s: FirebaseSnapshot) => {
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
    }
  });

  // Load persisted IWAD textures
  loadTexturesFromDb();
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
