import { vi, beforeEach, expect } from 'vitest';
import { maps } from '../../src/state/appState';
import { onLinedefAdded, onLinedefChanged, onLinedefRemoved, onSidedefAdded, onSidedefChanged, onSidedefRemoved, rebuildIndices } from '../../src/state/indices';
import { pointInSector } from '../../src/geometry/cycleFinder';
import { nearestLinedef } from '../../src/geometry/hitTest';
import { findSectorOverlaps } from '../../src/map/overlapCheck';
import { drawReset } from '../../src/map/drawSession';

// ── Firebase mock ──
let keyCounter = 0;
function nextKey() { return 'k' + (++keyCounter); }

vi.mock('../../src/config/firebase', () => {
  const makeRef = (basePath: string) => ({
    push: (val: any) => {
      const key = nextKey();
      const col = basePath.replace('map/', '');
      if ((maps as any)[col]) (maps as any)[col].set(key, { ...val });
      if (col === 'linedefs' && val.v1 && val.v2) onLinedefAdded(key, val.v1, val.v2);
      else if (col === 'sidedefs' && val.sector) onSidedefAdded(key, val.sector);
      const result = Promise.resolve({ key }) as any;
      result.key = key;
      return result;
    },
    child: (id: string) => ({
      update: (val: any) => {
        const col = basePath.replace('map/', '');
        if ((maps as any)[col]) {
          const existing = (maps as any)[col].get(id);
          if (existing) {
            const oldV1 = existing.v1, oldV2 = existing.v2, oldSector = existing.sector;
            (maps as any)[col].set(id, { ...existing, ...val });
            if (col === 'linedefs') { const u = (maps as any)[col].get(id); onLinedefChanged(id, u.v1, u.v2, oldV1, oldV2); }
            else if (col === 'sidedefs') { const u = (maps as any)[col].get(id); onSidedefChanged(id, u.sector, oldSector); }
          }
        }
        return Promise.resolve();
      },
      remove: () => {
        const col = basePath.replace('map/', '');
        if (col === 'linedefs') { const e = (maps as any)[col]?.get(id); if (e) onLinedefRemoved(id, e.v1, e.v2); }
        else if (col === 'sidedefs') { const e = (maps as any)[col]?.get(id); if (e) onSidedefRemoved(id, e.sector); }
        if ((maps as any)[col]) (maps as any)[col].delete(id);
        return Promise.resolve();
      },
    }),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    on: () => {},
    once: () => Promise.resolve({ val: () => null }),
    onDisconnect: () => ({ remove: () => {} }),
  });
  return {
    db: { ref: (p: string) => makeRef(p || '') },
    mapRef: (col: string) => makeRef('map/' + col),
  };
});

vi.mock('../../src/history/undoRedo', () => ({ beginAction: () => {}, record: () => {}, endAction: () => {} }));
vi.mock('../../src/ui/toast', () => ({ showToast: () => {} }));
vi.mock('../../src/canvas/renderer', () => ({ draw: () => {} }));
vi.mock('../../src/ui/propertiesPanel', () => ({ renderPanel: () => {} }));
vi.mock('../../src/ui/thingBrowser', () => ({ getSelectedThingType: () => 1, setSelectedThingType: () => {} }));
vi.mock('../../src/wad/textureLoader', () => ({ getTextureDataUrl: () => null, isWadLoaded: () => false, getSpritePrefixEntry: () => null }));

export function clearMaps() {
  maps.vertices.clear();
  maps.linedefs.clear();
  maps.sidedefs.clear();
  maps.sectors.clear();
  maps.things.clear();
  rebuildIndices();
  keyCounter = 0;
}

export function findVertexAt(x: number, y: number): string | null {
  for (const [id, v] of maps.vertices) if (v.x === x && v.y === y) return id;
  return null;
}

export function findSectorAt(x: number, y: number): string | null {
  for (const [sid] of maps.sectors) if (pointInSector(x, y, sid)) return sid;
  return null;
}

export function findLinedefNear(x: number, y: number): string | null {
  return nearestLinedef(x, y, Infinity);
}

beforeEach(() => { clearMaps(); drawReset(); });

// ── Map validation ──

export function expectNoSectorOverlaps(): void {
  const overlaps = findSectorOverlaps();
  if (overlaps.length > 0) {
    const o = overlaps[0];
    expect.fail(`Sectors ${o.sectorA} and ${o.sectorB} overlap: ${o.reason}`);
  }
}

export function expectMapIsValid(): void {
  const errors: string[] = [];

  // ── Referential integrity ──

  for (const [lid, ld] of maps.linedefs) {
    if (!maps.vertices.has(ld.v1)) errors.push(`linedef ${lid}: v1 ${ld.v1} missing`);
    if (!maps.vertices.has(ld.v2)) errors.push(`linedef ${lid}: v2 ${ld.v2} missing`);
    if (ld.frontSide && !maps.sidedefs.has(ld.frontSide)) errors.push(`linedef ${lid}: frontSide ${ld.frontSide} missing`);
    if (ld.backSide && !maps.sidedefs.has(ld.backSide)) errors.push(`linedef ${lid}: backSide ${ld.backSide} missing`);
  }

  for (const [sdid, sd] of maps.sidedefs) {
    if (!sd.sector || !maps.sectors.has(sd.sector)) errors.push(`sidedef ${sdid}: sector ${sd.sector} missing`);
  }

  // ── Degenerate linedefs ──

  for (const [lid, ld] of maps.linedefs) {
    if (ld.v1 === ld.v2) errors.push(`linedef ${lid}: zero-length (v1 === v2 === ${ld.v1})`);
  }

  // ── Duplicate linedefs ──

  const ldPairs = new Map<string, string>();
  for (const [lid, ld] of maps.linedefs) {
    const key1 = ld.v1 + '|' + ld.v2;
    const key2 = ld.v2 + '|' + ld.v1;
    const existing = ldPairs.get(key1) || ldPairs.get(key2);
    if (existing) errors.push(`linedef ${lid}: duplicate of ${existing} (${ld.v1} <-> ${ld.v2})`);
    else ldPairs.set(key1, lid);
  }

  // ── Orphaned vertices ──

  const usedVerts = new Set<string>();
  for (const [, ld] of maps.linedefs) { usedVerts.add(ld.v1); usedVerts.add(ld.v2); }
  for (const [vid] of maps.vertices) {
    if (!usedVerts.has(vid)) errors.push(`vertex ${vid}: orphaned (no linedef references it)`);
  }

  // ── Orphaned / multiply-owned sidedefs ──

  const sdRefCount = new Map<string, string[]>();
  for (const [lid, ld] of maps.linedefs) {
    if (ld.frontSide) (sdRefCount.get(ld.frontSide) ?? (sdRefCount.set(ld.frontSide, []), sdRefCount.get(ld.frontSide)!)).push(lid);
    if (ld.backSide) (sdRefCount.get(ld.backSide) ?? (sdRefCount.set(ld.backSide, []), sdRefCount.get(ld.backSide)!)).push(lid);
  }
  for (const [sdid] of maps.sidedefs) {
    const refs = sdRefCount.get(sdid);
    if (!refs) errors.push(`sidedef ${sdid}: orphaned (no linedef references it)`);
    else if (refs.length > 1) errors.push(`sidedef ${sdid}: owned by multiple linedefs (${refs.join(', ')})`);
  }

  // ── Degenerate sectors (fewer than 3 sidedefs) ──

  const sectorSdCount = new Map<string, number>();
  for (const [, sd] of maps.sidedefs) {
    if (sd.sector) sectorSdCount.set(sd.sector, (sectorSdCount.get(sd.sector) ?? 0) + 1);
  }
  for (const [sid] of maps.sectors) {
    const count = sectorSdCount.get(sid) ?? 0;
    if (count < 3) errors.push(`sector ${sid}: degenerate (only ${count} sidedef${count === 1 ? '' : 's'})`);
  }

  // ── Sector overlaps ──

  const overlaps = findSectorOverlaps();
  for (const o of overlaps) {
    errors.push(`sectors ${o.sectorA} / ${o.sectorB} overlap: ${o.reason}`);
  }

  if (errors.length > 0) {
    expect.fail(`Map validation failed:\n  ${errors.join('\n  ')}`);
  }
}
