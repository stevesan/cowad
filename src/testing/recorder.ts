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

  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push(`import { maps } from '../../src/state/appState';`);
  lines.push(`import { findVertexAt, findSectorAt } from './setup';`);
  lines.push(`import { createSectorFromPolygon, splitSector, deleteSelected } from '../../src/map/mapActions';`);
  lines.push(`import { setSelected } from '../../src/state/appState';`);
  lines.push(``);
  lines.push(`describe('recorded test case', () => {`);
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
