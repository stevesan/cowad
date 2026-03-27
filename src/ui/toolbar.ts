import { db } from '../config/firebase';
import { setSelected } from '../state/appState';
import { cleanupMap } from '../map/mapCleanup';
import { exportWAD, launchWAD } from '../export/wadExport';
import { exportJSON, importJSON } from '../export/jsonExport';
import { importWad } from '../wad/textureLoader';
import { toggle3D, is3DActive } from '../3d/view3d';
import { isRecording, startRecording, stopRecording, generateTestCode, exportRecording } from '../testing/recorder';
import { showToast } from './toast';
import { renderPanel } from './propertiesPanel';
import { openThingBrowser } from './thingBrowser';
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

  document.getElementById('thing-type-btn')!.addEventListener('click', () => {
    openThingBrowser(() => doSetTool('thing'));
  });

  document.getElementById('view3d-btn')!.addEventListener('click', () => {
    toggle3D();
    document.getElementById('view3d-btn')!.classList.toggle('active', is3DActive());
  });

  const recordBtn = document.getElementById('record-btn')!;
  const recordModal = document.getElementById('record-modal')!;
  const recordOutput = document.getElementById('record-output') as HTMLTextAreaElement;
  let recordSteps: any[] = [];

  recordBtn.addEventListener('click', () => {
    if (isRecording()) {
      recordSteps = stopRecording();
      recordBtn.textContent = 'Record';
      recordBtn.style.background = '#2a1a1a';
      showToast(`Recording stopped — ${recordSteps.length} step(s)`);
      if (recordSteps.length) {
        recordOutput.value = generateTestCode(recordSteps);
        recordModal.style.display = 'flex';
      }
    } else {
      startRecording();
      recordBtn.textContent = '\u25CF REC';
      recordBtn.style.background = '#4a1a1a';
      showToast('Recording started — draw sectors, split, delete...');
    }
  });

  document.getElementById('record-copy-test')!.addEventListener('click', () => {
    navigator.clipboard.writeText(generateTestCode(recordSteps));
    showToast('Test code copied to clipboard');
  });

  document.getElementById('record-copy-json')!.addEventListener('click', () => {
    navigator.clipboard.writeText(exportRecording(recordSteps));
    showToast('JSON recording copied to clipboard');
  });

  document.getElementById('record-close')!.addEventListener('click', () => {
    recordModal.style.display = 'none';
  });

  document.getElementById('clean-btn')!.addEventListener('click', cleanupMap);
  document.getElementById('wad-btn')!.addEventListener('click', exportWAD);
  document.getElementById('json-export-btn')!.addEventListener('click', exportJSON);
  document.getElementById('json-import-btn')!.addEventListener('click', importJSON);
  document.getElementById('play-btn')!.addEventListener('click', () => launchWAD());

  document.getElementById('clear-btn')!.addEventListener('click', () => {
    if (!confirm('Clear the entire map? This cannot be undone.')) return;
    db.ref('map').remove();
    setSelected(null);
    renderPanel();
  });
}
