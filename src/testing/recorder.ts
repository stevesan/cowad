import { maps } from '../state/appState';
import { buildSectorPoly } from '../geometry/cycleFinder';

export type RecordedStep =
  | { action: 'drawClick'; x: number; y: number }
  | { action: 'drawComplete' }
  | { action: 'deleteSelected'; deleteType: string; x: number; y: number }
  | { action: 'assertCounts'; counts: { sectors: number; vertices: number; linedefs: number; sidedefs: number } };

let recording = false;
let steps: RecordedStep[] = [];
let pendingDelete: { type: string; x: number; y: number } | null = null;

export function isRecording(): boolean { return recording; }

export function startRecording(): void {
  recording = true;
  steps = [];
  pendingDelete = null;
}

export function stopRecording(): RecordedStep[] {
  recording = false;
  pendingDelete = null;
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

// ── Hooks called from drawSession ──

export function recordDrawClick(x: number, y: number): void {
  if (!recording) return;
  steps.push({ action: 'drawClick', x, y });
}

export function recordDrawComplete(): void {
  if (!recording) return;
  steps.push({ action: 'drawComplete' });
}

// ── Hooks called from mapActions ──

/** Call after createSectorFromPolygon or splitSector completes. */
export function recordSectorDone(): void {
  if (!recording) return;
  steps.push({ action: 'assertCounts', counts: snapshot() });
}

/** Call BEFORE deleteSelected mutates state. */
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
    const poly = buildSectorPoly(id);
    if (poly && poly.length >= 3) {
      let cx = 0, cy = 0;
      for (const p of poly) { cx += p.x; cy += p.y; }
      pt = { x: cx / poly.length, y: cy / poly.length };
    }
  } else if (type === 'thing') {
    const t = maps.things.get(id);
    if (t) pt = { x: t.x, y: t.y };
  }
  pendingDelete = { type, x: pt?.x ?? 0, y: pt?.y ?? 0 };
}

/** Call AFTER deleteSelected completes. */
export function recordDeleteDone(): void {
  if (!recording) return;
  if (pendingDelete) {
    steps.push({ action: 'deleteSelected', deleteType: pendingDelete.type, x: pendingDelete.x, y: pendingDelete.y });
  }
  steps.push({ action: 'assertCounts', counts: snapshot() });
  pendingDelete = null;
}

// ── Code generation ──

export function generateTestCode(testSteps: RecordedStep[]): string {
  const lines: string[] = [];

  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push(`import { maps, setSelected } from '../../src/state/appState';`);
  lines.push(`import { drawClick, drawComplete } from '../../src/map/drawSession';`);
  lines.push(`import { findVertexAt, findSectorAt, expectNoSectorOverlaps } from './setup';`);
  lines.push(`import { deleteSelected } from '../../src/map/mapActions';`);
  lines.push(``);
  lines.push(`describe('recorded test case', () => {`);
  lines.push(`  it('should produce correct map state', async () => {`);

  for (const step of testSteps) {
    switch (step.action) {
      case 'drawClick':
        lines.push(`    await drawClick(${step.x}, ${step.y});`);
        break;
      case 'drawComplete':
        lines.push(`    await drawComplete();`);
        break;
      case 'deleteSelected':
        if (step.deleteType === 'sector') {
          lines.push(`    setSelected({ type: 'sector', id: findSectorAt(${step.x}, ${step.y})! });`);
        } else if (step.deleteType === 'vertex') {
          lines.push(`    setSelected({ type: 'vertex', id: findVertexAt(${step.x}, ${step.y})! });`);
        } else {
          lines.push(`    // TODO: select ${step.deleteType} at (${step.x}, ${step.y})`);
        }
        lines.push(`    deleteSelected();`);
        break;
      case 'assertCounts':
        lines.push(`    expect(maps.sectors.size).toBe(${step.counts.sectors});`);
        lines.push(`    expect(maps.vertices.size).toBe(${step.counts.vertices});`);
        lines.push(`    expect(maps.linedefs.size).toBe(${step.counts.linedefs});`);
        lines.push(``);
        break;
    }
  }

  lines.push(`    expectNoSectorOverlaps();`);
  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);

  return lines.join('\n');
}

/** Generate JSON-serializable recording for sharing. */
export function exportRecording(testSteps: RecordedStep[]): string {
  return JSON.stringify(testSteps, null, 2);
}
