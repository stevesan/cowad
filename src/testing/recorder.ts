import { maps } from '../state/appState';
import { buildSectorPoly } from '../geometry/cycleFinder';
import type { DrawVertex } from '../types';

export interface RecordedStep {
  action: 'createSector' | 'splitSector' | 'deleteSelected';
  chain?: { x: number; y: number; existing: boolean }[];
  /** Point inside the sector being split (captured before mutation) */
  sectorAt?: { x: number; y: number };
  /** For delete: what kind of element and a representative point */
  deleteType?: string;
  deleteAt?: { x: number; y: number };
  /** Map counts after the action completed */
  counts: { sectors: number; vertices: number; linedefs: number; sidedefs: number };
}

let recording = false;
let steps: RecordedStep[] = [];
/** Stashed pre-mutation data for split/delete (captured in "before" hook) */
let pending: Partial<RecordedStep> | null = null;

export function isRecording(): boolean { return recording; }

export function startRecording(): void {
  recording = true;
  steps = [];
  pending = null;
}

export function stopRecording(): RecordedStep[] {
  recording = false;
  pending = null;
  return steps;
}

function snapshot() {
  return {
    sectors: maps.sectors.size,
    vertices: maps.vertices.size,
    linedefs: maps.linedefs.size,
    sidedefs: maps.sidedefs.size,
  };
}

function sectorCentroid(sid: string): { x: number; y: number } | null {
  const poly = buildSectorPoly(sid);
  if (!poly || poly.length < 3) return null;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
}

function chainData(chain: DrawVertex[]) {
  return chain.map(v => ({ x: v.x, y: v.y, existing: !!v.existingId }));
}

// ── Hooks called from mapActions ──

export function recordCreateDone(chain: DrawVertex[]): void {
  if (!recording) return;
  steps.push({ action: 'createSector', chain: chainData(chain), counts: snapshot() });
}

/** Call BEFORE the split mutates state (to capture sector centroid). */
export function recordSplitBefore(chain: DrawVertex[], sectorId: string): void {
  if (!recording) return;
  pending = {
    action: 'splitSector',
    chain: chainData(chain),
    sectorAt: sectorCentroid(sectorId) ?? { x: 0, y: 0 },
  };
}

/** Call AFTER split completes. */
export function recordSplitDone(): void {
  if (!recording || !pending) return;
  steps.push({ ...pending, counts: snapshot() } as RecordedStep);
  pending = null;
}

/** Call BEFORE delete mutates state. */
export function recordDeleteBefore(type: string, id: string): void {
  if (!recording) return;
  let pt: { x: number; y: number } | null = null;
  if (type === 'vertex') {
    const v = maps.vertices.get(id);
    if (v) pt = { x: v.x, y: v.y };
  } else if (type === 'linedef') {
    const ld = maps.linedefs.get(id);
    if (ld) {
      const a = maps.vertices.get(ld.v1), b = maps.vertices.get(ld.v2);
      if (a && b) pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  } else if (type === 'sector') {
    pt = sectorCentroid(id);
  } else if (type === 'thing') {
    const t = maps.things.get(id);
    if (t) pt = { x: t.x, y: t.y };
  }
  pending = { action: 'deleteSelected', deleteType: type, deleteAt: pt ?? { x: 0, y: 0 } };
}

/** Call AFTER delete completes. */
export function recordDeleteDone(): void {
  if (!recording || !pending) return;
  steps.push({ ...pending, counts: snapshot() } as RecordedStep);
  pending = null;
}

// ── Code generation ──

export function generateTestCode(testSteps: RecordedStep[]): string {
  const lines: string[] = [];

  lines.push(`import { describe, it, expect, beforeEach, vi } from 'vitest';`);
  lines.push(`import { maps } from '../../src/state/appState';`);
  lines.push(`import { onLinedefAdded, onLinedefChanged, onLinedefRemoved, onSidedefAdded, onSidedefChanged, onSidedefRemoved, rebuildIndices } from '../../src/state/indices';`);
  lines.push(`import type { DrawVertex } from '../../src/types';`);
  lines.push(``);
  lines.push(`// ── Firebase mock ──`);
  lines.push(`let keyCounter = 0;`);
  lines.push(`function nextKey() { return 'k' + (++keyCounter); }`);
  lines.push(``);
  lines.push(`vi.mock('../../src/config/firebase', () => {`);
  lines.push(`  const makeRef = (basePath: string) => ({`);
  lines.push(`    push: (val: any) => {`);
  lines.push(`      const key = nextKey();`);
  lines.push(`      const col = basePath.replace('map/', '');`);
  lines.push(`      if ((maps as any)[col]) (maps as any)[col].set(key, { ...val });`);
  lines.push(`      if (col === 'linedefs' && val.v1 && val.v2) onLinedefAdded(key, val.v1, val.v2);`);
  lines.push(`      else if (col === 'sidedefs' && val.sector) onSidedefAdded(key, val.sector);`);
  lines.push(`      const result = Promise.resolve({ key }) as any;`);
  lines.push(`      result.key = key;`);
  lines.push(`      return result;`);
  lines.push(`    },`);
  lines.push(`    child: (id: string) => ({`);
  lines.push(`      update: (val: any) => {`);
  lines.push(`        const col = basePath.replace('map/', '');`);
  lines.push(`        if ((maps as any)[col]) {`);
  lines.push(`          const existing = (maps as any)[col].get(id);`);
  lines.push(`          if (existing) {`);
  lines.push(`            const oldV1 = existing.v1, oldV2 = existing.v2, oldSector = existing.sector;`);
  lines.push(`            (maps as any)[col].set(id, { ...existing, ...val });`);
  lines.push(`            if (col === 'linedefs') { const u = (maps as any)[col].get(id); onLinedefChanged(id, u.v1, u.v2, oldV1, oldV2); }`);
  lines.push(`            else if (col === 'sidedefs') { const u = (maps as any)[col].get(id); onSidedefChanged(id, u.sector, oldSector); }`);
  lines.push(`          }`);
  lines.push(`        }`);
  lines.push(`        return Promise.resolve();`);
  lines.push(`      },`);
  lines.push(`      remove: () => {`);
  lines.push(`        const col = basePath.replace('map/', '');`);
  lines.push(`        if (col === 'linedefs') { const e = (maps as any)[col]?.get(id); if (e) onLinedefRemoved(id, e.v1, e.v2); }`);
  lines.push(`        else if (col === 'sidedefs') { const e = (maps as any)[col]?.get(id); if (e) onSidedefRemoved(id, e.sector); }`);
  lines.push(`        if ((maps as any)[col]) (maps as any)[col].delete(id);`);
  lines.push(`        return Promise.resolve();`);
  lines.push(`      },`);
  lines.push(`    }),`);
  lines.push(`    set: () => Promise.resolve(),`);
  lines.push(`    remove: () => Promise.resolve(),`);
  lines.push(`    on: () => {},`);
  lines.push(`    once: () => Promise.resolve({ val: () => null }),`);
  lines.push(`    onDisconnect: () => ({ remove: () => {} }),`);
  lines.push(`  });`);
  lines.push(`  return {`);
  lines.push(`    db: { ref: (p: string) => makeRef(p || '') },`);
  lines.push(`    mapRef: (col: string) => makeRef('map/' + col),`);
  lines.push(`  };`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`vi.mock('../../src/history/undoRedo', () => ({ beginAction: () => {}, record: () => {}, endAction: () => {} }));`);
  lines.push(`vi.mock('../../src/ui/toast', () => ({ showToast: () => {} }));`);
  lines.push(`vi.mock('../../src/canvas/renderer', () => ({ draw: () => {} }));`);
  lines.push(`vi.mock('../../src/ui/propertiesPanel', () => ({ renderPanel: () => {} }));`);
  lines.push(`vi.mock('../../src/ui/thingBrowser', () => ({ getSelectedThingType: () => 1, setSelectedThingType: () => {} }));`);
  lines.push(`vi.mock('../../src/wad/textureLoader', () => ({ getTextureDataUrl: () => null, isWadLoaded: () => false, getSpritePrefixEntry: () => null }));`);
  lines.push(``);
  lines.push(`import { createSectorFromPolygon, splitSector, deleteSelected } from '../../src/map/mapActions';`);
  lines.push(`import { buildSectorLoopIds } from '../../src/geometry/cycleFinder';`);
  lines.push(`import { pointInSector } from '../../src/geometry/cycleFinder';`);
  lines.push(`import { setSelected } from '../../src/state/appState';`);
  lines.push(``);
  lines.push(`function findVertexAt(x: number, y: number): string | null {`);
  lines.push(`  for (const [id, v] of maps.vertices) if (v.x === x && v.y === y) return id;`);
  lines.push(`  return null;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function findSectorAt(x: number, y: number): string | null {`);
  lines.push(`  for (const [sid] of maps.sectors) if (pointInSector(x, y, sid)) return sid;`);
  lines.push(`  return null;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`function clearMaps() {`);
  lines.push(`  maps.vertices.clear(); maps.linedefs.clear(); maps.sidedefs.clear();`);
  lines.push(`  maps.sectors.clear(); maps.things.clear();`);
  lines.push(`  rebuildIndices(); keyCounter = 0;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`describe('recorded test case', () => {`);
  lines.push(`  beforeEach(() => { clearMaps(); });`);
  lines.push(``);
  lines.push(`  it('should produce correct map state', async () => {`);

  for (let i = 0; i < testSteps.length; i++) {
    const step = testSteps[i];
    const n = i + 1;
    lines.push(``);

    if (step.action === 'createSector' && step.chain) {
      lines.push(`    // Step ${n}: create sector`);
      const chainStr = step.chain.map(v => {
        if (v.existing) return `      { x: ${v.x}, y: ${v.y}, existingId: findVertexAt(${v.x}, ${v.y})! },`;
        return `      { x: ${v.x}, y: ${v.y} },`;
      }).join('\n');
      lines.push(`    const sid${n} = await createSectorFromPolygon([`);
      lines.push(chainStr);
      lines.push(`    ]);`);
      lines.push(`    expect(sid${n}).toBeTruthy();`);

    } else if (step.action === 'splitSector' && step.chain && step.sectorAt) {
      lines.push(`    // Step ${n}: split sector`);
      lines.push(`    const splitTarget${n} = findSectorAt(${step.sectorAt.x}, ${step.sectorAt.y})!;`);
      lines.push(`    expect(splitTarget${n}).toBeTruthy();`);
      const chainStr = step.chain.map(v => {
        if (v.existing) return `      { x: ${v.x}, y: ${v.y}, existingId: findVertexAt(${v.x}, ${v.y})! },`;
        return `      { x: ${v.x}, y: ${v.y} },`;
      }).join('\n');
      lines.push(`    const [kept${n}, new${n}] = (await splitSector([`);
      lines.push(chainStr);
      lines.push(`    ], splitTarget${n}))!;`);

    } else if (step.action === 'deleteSelected' && step.deleteType && step.deleteAt) {
      lines.push(`    // Step ${n}: delete ${step.deleteType}`);
      if (step.deleteType === 'sector') {
        lines.push(`    const delTarget${n} = findSectorAt(${step.deleteAt.x}, ${step.deleteAt.y})!;`);
        lines.push(`    expect(delTarget${n}).toBeTruthy();`);
        lines.push(`    setSelected({ type: 'sector', id: delTarget${n} });`);
      } else if (step.deleteType === 'vertex') {
        lines.push(`    const delTarget${n} = findVertexAt(${step.deleteAt.x}, ${step.deleteAt.y})!;`);
        lines.push(`    expect(delTarget${n}).toBeTruthy();`);
        lines.push(`    setSelected({ type: 'vertex', id: delTarget${n} });`);
      } else {
        lines.push(`    // TODO: resolve ${step.deleteType} at (${step.deleteAt.x}, ${step.deleteAt.y})`);
        lines.push(`    // setSelected({ type: '${step.deleteType}', id: ??? });`);
      }
      lines.push(`    deleteSelected();`);
    }

    // Assertions on counts
    lines.push(`    expect(maps.sectors.size).toBe(${step.counts.sectors});`);
    lines.push(`    expect(maps.vertices.size).toBe(${step.counts.vertices});`);
    lines.push(`    expect(maps.linedefs.size).toBe(${step.counts.linedefs});`);
  }

  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);

  return lines.join('\n');
}

/** Generate JSON-serializable recording for sharing. */
export function exportRecording(testSteps: RecordedStep[]): string {
  return JSON.stringify(testSteps, null, 2);
}
