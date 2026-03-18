import { db } from '../config/firebase';
import { setSelected } from '../state/appState';
import { cleanupMap } from '../map/mapCleanup';
import { exportWAD, launchWAD } from '../export/wadExport';
import { importWad } from '../wad/textureLoader';
import { showToast } from './toast';
import { renderPanel } from './propertiesPanel';
import type { ToolType } from '../types';

export function initToolbar(doSetTool: (t: ToolType) => void): void {
  document.querySelectorAll<HTMLElement>('.tool-btn').forEach(b =>
    b.addEventListener('click', () => doSetTool(b.dataset.tool as ToolType))
  );

  document.getElementById('import-wad-btn')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wad';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        showToast('Importing WAD...');
        const { flats, walls } = await importWad(file);
        showToast(`Loaded ${flats} flats + ${walls} wall textures`);
        renderPanel(); // refresh to show texture previews
      } catch (err: any) {
        showToast(`Import failed: ${err.message}`);
      }
    });
    input.click();
  });

  document.getElementById('clean-btn')!.addEventListener('click', cleanupMap);
  document.getElementById('wad-btn')!.addEventListener('click', exportWAD);
  document.getElementById('play-btn')!.addEventListener('click', launchWAD);

  document.getElementById('clear-btn')!.addEventListener('click', () => {
    if (!confirm('Clear the entire map? This cannot be undone.')) return;
    db.ref('map').remove();
    setSelected(null);
    renderPanel();
  });
}
