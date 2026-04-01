import { maps } from '../state/appState';
import { db } from '../config/firebase';
import { showToast } from '../ui/toast';
import { zoomToFit } from '../canvas/renderer';
import type { MapCollection } from '../types';

const FORMAT_VERSION = 1;
const COLLECTIONS: MapCollection[] = ['vertices', 'linedefs', 'sidedefs', 'sectors', 'things'];

function mapToObj(m: Map<string, any>): Record<string, any> {
  const o: Record<string, any> = {};
  m.forEach((v, k) => { o[k] = v; });
  return o;
}

export function exportJSON(): void {
  const data: Record<string, any> = { version: FORMAT_VERSION };
  for (const col of COLLECTIONS) {
    data[col] = mapToObj(maps[col]);
  }
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Map exported as JSON');
}

async function importFile(file: File): Promise<void> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (typeof data.version !== 'number') {
    showToast('Invalid file: missing version');
    return;
  }
  if (data.version > FORMAT_VERSION) {
    showToast(`File version ${data.version} is newer than supported (${FORMAT_VERSION})`);
    return;
  }
  if (!confirm('Import will replace the current map. Continue?')) return;

  const update: Record<string, any> = {};
  for (const col of COLLECTIONS) {
    update['map/' + col] = data[col] ?? null;
  }
  await db.ref().update(update);
  zoomToFit();
  showToast('Map imported from JSON');
}

export function importJSON(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await importFile(file);
    } catch (err: any) {
      showToast('Import failed: ' + err.message);
    }
  });
  input.click();
}

export function initDropImport(): void {
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file || !file.name.endsWith('.json')) return;
    try {
      await importFile(file);
    } catch (err: any) {
      showToast('Import failed: ' + err.message);
    }
  });
}
