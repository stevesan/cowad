import { db } from '../config/firebase.js';
import { setSelected, triggerRenderPanel } from '../state/appState.js';
import { cleanupMap } from '../map/mapCleanup.js';
import { exportWAD } from '../export/wadExport.js';
import { renderPanel } from './propertiesPanel.js';

export function initToolbar(doSetTool) {
  document.querySelectorAll('.tool-btn').forEach(b =>
    b.addEventListener('click', () => doSetTool(b.dataset.tool))
  );

  document.getElementById('clean-btn').addEventListener('click', cleanupMap);
  document.getElementById('wad-btn').addEventListener('click', exportWAD);

  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!confirm('Clear the entire map? This cannot be undone.')) return;
    db.ref('map').remove();
    setSelected(null);
    renderPanel();
  });
}
