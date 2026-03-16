import { db } from '../config/firebase';
import { setSelected } from '../state/appState';
import { cleanupMap } from '../map/mapCleanup';
import { exportWAD } from '../export/wadExport';
import { renderPanel } from './propertiesPanel';
import type { ToolType } from '../types';

export function initToolbar(doSetTool: (t: ToolType) => void): void {
  document.querySelectorAll<HTMLElement>('.tool-btn').forEach(b =>
    b.addEventListener('click', () => doSetTool(b.dataset.tool as ToolType))
  );

  document.getElementById('clean-btn')!.addEventListener('click', cleanupMap);
  document.getElementById('wad-btn')!.addEventListener('click', exportWAD);

  document.getElementById('clear-btn')!.addEventListener('click', () => {
    if (!confirm('Clear the entire map? This cannot be undone.')) return;
    db.ref('map').remove();
    setSelected(null);
    renderPanel();
  });
}
