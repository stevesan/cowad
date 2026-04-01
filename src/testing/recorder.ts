import { maps } from '../state/appState';
import { buildSectorPoly, pointInSector } from '../geometry/cycleFinder';

export type RecordedStep =
  | { action: 'drawClick'; x: number; y: number }
  | { action: 'drawComplete' }
  | { action: 'deleteSelected'; deleteType: string; x: number; y: number }
  | { action: 'deleteMultiSelected'; vertices: { x: number; y: number }[] }
  | { action: 'mergeVertices'; x1: number; y1: number; x2: number; y2: number }
  | { action: 'mergeSectors'; sectorPoints: { x: number; y: number }[] }
  | { action: 'bridgeLinedefs'; mid1: { x: number; y: number }; mid2: { x: number; y: number } }
  | { action: 'placeThing'; x: number; y: number }
  | { action: 'splitLinedef'; ldMid: { x: number; y: number }; splitX: number; splitY: number }
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

/** Find a point guaranteed to be inside a sector (handles non-convex polygons). */
function sectorInteriorPoint(sid: string): { x: number; y: number } | null {
  const poly = buildSectorPoly(sid);
  if (!poly || poly.length < 3) return null;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  if (pointInSector(cx, cy, sid)) return { x: cx, y: cy };
  // Centroid outside (non-convex) — try centroid of each consecutive vertex triple
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const tx = (a.x + b.x + c.x) / 3, ty = (a.y + b.y + c.y) / 3;
    if (pointInSector(tx, ty, sid)) return { x: tx, y: ty };
  }
  return { x: cx, y: cy }; // fallback
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
    pt = sectorInteriorPoint(id);
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

// ── Hooks called from mapActions (merge / bridge / place / split) ──

export function recordMergeVertices(vidA: string, vidB: string): void {
  if (!recording) return;
  const vA = maps.vertices.get(vidA);
  const vB = maps.vertices.get(vidB);
  if (!vA || !vB) return;
  steps.push({ action: 'mergeVertices', x1: vA.x, y1: vA.y, x2: vB.x, y2: vB.y });
  steps.push({ action: 'assertCounts', counts: snapshot() });
}

export function recordMergeSectors(sids: string[]): void {
  if (!recording) return;
  const pts: { x: number; y: number }[] = [];
  for (const sid of sids) {
    const pt = sectorInteriorPoint(sid);
    if (pt) pts.push(pt);
  }
  steps.push({ action: 'mergeSectors', sectorPoints: pts });
  steps.push({ action: 'assertCounts', counts: snapshot() });
}

export function recordBridgeLinedefs(lid1: string, lid2: string): void {
  if (!recording) return;
  const ld1 = maps.linedefs.get(lid1);
  const ld2 = maps.linedefs.get(lid2);
  if (!ld1 || !ld2) return;
  const midOf = (ld: { v1: string; v2: string }) => {
    const a = maps.vertices.get(ld.v1), b = maps.vertices.get(ld.v2);
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  steps.push({ action: 'bridgeLinedefs', mid1: midOf(ld1), mid2: midOf(ld2) });
  // assertCounts will be added by recordSectorDone via createSectorFromPolygon
}

export function recordPlaceThing(x: number, y: number): void {
  if (!recording) return;
  steps.push({ action: 'placeThing', x, y });
  steps.push({ action: 'assertCounts', counts: snapshot() });
}

export function recordSplitLinedef(lid: string, splitX: number, splitY: number): void {
  if (!recording) return;
  const ld = maps.linedefs.get(lid);
  if (!ld) return;
  const a = maps.vertices.get(ld.v1), b = maps.vertices.get(ld.v2);
  const mid = (a && b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  steps.push({ action: 'splitLinedef', ldMid: mid, splitX, splitY });
  steps.push({ action: 'assertCounts', counts: snapshot() });
}

export function recordDeleteMultiSelected(vids: Set<string>): void {
  if (!recording) return;
  const vertices: { x: number; y: number }[] = [];
  for (const vid of vids) {
    const v = maps.vertices.get(vid);
    if (v) vertices.push({ x: v.x, y: v.y });
  }
  steps.push({ action: 'deleteMultiSelected', vertices });
  steps.push({ action: 'assertCounts', counts: snapshot() });
}

// ── Code generation ──

function toCamelCase(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

export function generateTestCode(testSteps: RecordedStep[], title: string): string {
  const lines: string[] = [];
  const camelTitle = toCamelCase(title);

  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push(`import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';`);
  lines.push(`import { drawClick, drawComplete } from '../../src/map/drawSession';`);
  lines.push(`import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';`);
  lines.push(`import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';`);
  lines.push(``);
  lines.push(`describe('${title}', () => {`);
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
      case 'deleteMultiSelected':
        lines.push(`    setMultiSelected(new Set([`);
        for (const v of step.vertices) {
          lines.push(`      findVertexAt(${v.x}, ${v.y})!,`);
        }
        lines.push(`    ]));`);
        lines.push(`    deleteMultiSelected();`);
        break;
      case 'mergeVertices':
        lines.push(`    setMultiSelected(new Set([findVertexAt(${step.x1}, ${step.y1})!, findVertexAt(${step.x2}, ${step.y2})!]));`);
        lines.push(`    mergeVertices();`);
        break;
      case 'mergeSectors':
        lines.push(`    setMultiSelected(new Set([`);
        for (const pt of step.sectorPoints) {
          lines.push(`      findSectorAt(${pt.x}, ${pt.y})!,`);
        }
        lines.push(`    ]));`);
        lines.push(`    mergeSectors();`);
        break;
      case 'bridgeLinedefs':
        lines.push(`    await bridgeLinedefs(findLinedefNear(${step.mid1.x}, ${step.mid1.y})!, findLinedefNear(${step.mid2.x}, ${step.mid2.y})!);`);
        break;
      case 'placeThing':
        lines.push(`    placeThing(${step.x}, ${step.y});`);
        break;
      case 'splitLinedef':
        lines.push(`    splitLinedefAtPoint(findLinedefNear(${step.ldMid.x}, ${step.ldMid.y})!, ${step.splitX}, ${step.splitY});`);
        break;
      case 'assertCounts':
        lines.push(`    expect(maps.sectors.size).toBe(${step.counts.sectors});`);
        lines.push(`    expect(maps.vertices.size).toBe(${step.counts.vertices});`);
        lines.push(`    expect(maps.linedefs.size).toBe(${step.counts.linedefs});`);
        lines.push(``);
        break;
    }
  }

  lines.push(`    dumpMapJSON('${camelTitle}');`);
  lines.push(`    expectMapIsValid();`);
  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);

  return lines.join('\n');
}

/** Generate JSON-serializable recording for sharing. */
export function exportRecording(testSteps: RecordedStep[]): string {
  return JSON.stringify(testSteps, null, 2);
}
