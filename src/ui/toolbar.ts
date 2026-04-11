import { db } from '../config/firebase';
import { setSelected } from '../state/appState';
import { cleanupMap } from '../map/mapCleanup';
import { exportWAD, launchWAD } from '../export/wadExport';
import { exportJSON, importJSON } from '../export/jsonExport';
import { findSectorOverlaps } from '../map/overlapCheck';
import { importWad } from '../wad/textureLoader';
import { toggle3D, is3DActive, set3DSplit } from '../3d/view3d';
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
        const { flats, walls, gameType } = await importWad(file);
        const gameName = gameType === 'doom1' ? 'DOOM' : 'DOOM 2';
        showToast(`${gameName}: loaded ${flats} flats + ${walls} wall textures`);
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

  const view3dBtn = document.getElementById('view3d-btn')!;
  view3dBtn.addEventListener('click', () => {
    toggle3D();
    view3dBtn.classList.toggle('active', is3DActive());
    localStorage.setItem('cowad-view-3d', String(is3DActive()));
  });

  const splitChk = document.getElementById('split3d-chk') as HTMLInputElement;
  splitChk.checked = localStorage.getItem('cowad-split-3d') === 'true';
  set3DSplit(splitChk.checked);
  splitChk.addEventListener('change', () => {
    localStorage.setItem('cowad-split-3d', String(splitChk.checked));
    set3DSplit(splitChk.checked);
  });

  // Restore saved 3D view state
  if (localStorage.getItem('cowad-view-3d') === 'true') {
    toggle3D();
    view3dBtn.classList.toggle('active', is3DActive());
  }

  const recordBtn = document.getElementById('record-btn')!;
  const recordModal = document.getElementById('record-modal')!;
  const recordOutput = document.getElementById('record-output') as HTMLTextAreaElement;
  let recordSteps: any[] = [];
  let recordTitle = 'recorded test case';

  recordBtn.addEventListener('click', () => {
    if (isRecording()) {
      recordSteps = stopRecording();
      recordBtn.textContent = 'Record';
      recordBtn.style.background = '#2a1a1a';
      showToast(`Recording stopped — ${recordSteps.length} step(s)`);
      if (recordSteps.length) {
        recordTitle = prompt('Test title:') || 'recorded test case';
        recordOutput.value = generateTestCode(recordSteps, recordTitle);
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
    navigator.clipboard.writeText(generateTestCode(recordSteps, recordTitle));
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
  document.getElementById('overlap-btn')!.addEventListener('click', () => {
    const overlaps = findSectorOverlaps();
    if (overlaps.length === 0) {
      showToast('No overlapping sectors found');
    } else {
      showToast(`${overlaps.length} overlap(s): ${overlaps.map(o => o.reason).join('; ')}`);
    }
  });
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

  document.getElementById('reset-local-btn')!.addEventListener('click', () => {
    if (!confirm('Are you sure? This will reset all your local settings. Make sure all your work is exported to a JSON file!')) return;
    localStorage.clear();
    indexedDB.deleteDatabase('cowad-local');
    location.reload();
  });

  // Overflow menu toggle
  const overflowToggle = document.querySelector('.overflow-toggle')!;
  const overflowDropdown = document.querySelector('.overflow-dropdown')!;
  overflowToggle.addEventListener('click', () => overflowDropdown.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.overflow-menu')) overflowDropdown.classList.remove('open');
  });
  // Close menu when any dropdown button is clicked
  overflowDropdown.querySelectorAll('button').forEach(btn =>
    btn.addEventListener('click', () => overflowDropdown.classList.remove('open'))
  );
}
