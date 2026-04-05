import { describe, it, expect, beforeEach } from 'vitest';
import { maps } from '../../src/state/appState';
import { rebuildIndices } from '../../src/state/indices';
import { expectNoSectorOverlaps } from './setup';
import { createSectorFromPolygon } from '../../src/map/mapActions';
import { findVertexAt } from './setup';

// Helper to manually build a sector from raw polygon coordinates,
// bypassing createSectorFromPolygon's overlap prevention.
// Returns the sector ID.
let rawId = 0;
function rawSector(verts: [number, number][]): string {
  const sid = 'raw_s' + (++rawId);
  maps.sectors.set(sid, { floor: 0, ceiling: 128, light: 160 });

  const vids: string[] = [];
  for (const [x, y] of verts) {
    // Reuse existing vertex at same coordinates
    let vid: string | null = null;
    for (const [id, v] of maps.vertices) {
      if (v.x === x && v.y === y) { vid = id; break; }
    }
    if (!vid) {
      vid = 'raw_v' + (++rawId);
      maps.vertices.set(vid, { x, y });
    }
    vids.push(vid);
  }

  for (let i = 0; i < vids.length; i++) {
    const v1 = vids[i], v2 = vids[(i + 1) % vids.length];
    const sdId = 'raw_sd' + (++rawId);
    maps.sidedefs.set(sdId, { sector: sid, upper: '-', mid: '-', lower: '-' });
    const ldId = 'raw_ld' + (++rawId);
    maps.linedefs.set(ldId, { v1, v2, flags: 1, frontSide: sdId, backSide: null });
  }

  rebuildIndices();
  return sid;
}

describe('expectNoSectorOverlaps', () => {
  beforeEach(() => { rawId = 0; });

  it('passes with a single sector', () => {
    rawSector([[0, 0], [100, 0], [100, 100], [0, 100]]);
    expectNoSectorOverlaps();
  });

  it('passes with two separate non-touching sectors', () => {
    rawSector([[0, 0], [100, 0], [100, 100], [0, 100]]);
    rawSector([[200, 0], [300, 0], [300, 100], [200, 100]]);
    expectNoSectorOverlaps();
  });

  it('detects crossing edges from partially overlapping squares', () => {
    //  Square A: (0,0)-(100,0)-(100,100)-(0,100)
    //  Square B: (50,50)-(150,50)-(150,150)-(50,150)
    //  These overlap in the region (50,50)-(100,50)-(100,100)-(50,100)
    rawSector([[0, 0], [100, 0], [100, 100], [0, 100]]);
    rawSector([[50, 50], [150, 50], [150, 150], [50, 150]]);
    expect(() => expectNoSectorOverlaps()).toThrow(/overlap/i);
  });

  it('detects small sector fully contained inside a large sector', () => {
    //  Large: (0,0)-(200,0)-(200,200)-(0,200)
    //  Small: (50,50)-(150,50)-(150,150)-(50,150)
    //  No edges cross, but small's vertices are inside large.
    rawSector([[0, 0], [200, 0], [200, 200], [0, 200]]);
    rawSector([[50, 50], [150, 50], [150, 150], [50, 150]]);
    expect(() => expectNoSectorOverlaps()).toThrow(/overlap/i);
  });

  it('detects triangle inside triangle sharing one edge', () => {
    //  Big:   (0,0)-(200,0)-(100,200)
    //  Small: (0,0)-(200,0)-(100,100)  — shares bottom edge, apex inside big
    rawSector([[0, 0], [200, 0], [100, 200]]);
    rawSector([[0, 0], [200, 0], [100, 100]]);
    expect(() => expectNoSectorOverlaps()).toThrow(/overlap/i);
  });

  it('passes with zero sectors', () => {
    expectNoSectorOverlaps();
  });
});
