import { describe, it, expect } from 'vitest';
import { maps } from '../../src/state/appState';
import { buildSectorLoopIds } from '../../src/geometry/cycleFinder';
import { createSectorFromPolygon } from '../../src/map/mapActions';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findSectorAt } from './setup';
import type { Point } from '../../src/types';

/** Signed area via shoelace formula. Positive = CCW, negative = CW (in y-up coords). */
function signedArea(loop: Point[]): number {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++)
    a += (loop[j].x + loop[i].x) * (loop[j].y - loop[i].y);
  return a / 2;
}

function loopToPoints(vertexIds: string[]): Point[] {
  return vertexIds.map(id => maps.vertices.get(id)!);
}

describe('buildSectorLoopIds winding order', () => {
  it('simple square: outer loop should be CCW', async () => {
    const sid = await createSectorFromPolygon([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(sid).toBeTruthy();

    const loops = buildSectorLoopIds(sid!);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(4);

    const area = signedArea(loopToPoints(loops[0]));
    expect(area).toBeGreaterThan(0); // CCW = positive signed area
  });

  it('pillar case: outer loop CCW, inner loop (hole) CW', async () => {
    // Draw outer square
    await drawClick(0, 0);
    await drawClick(200, 0);
    await drawClick(200, 200);
    await drawClick(0, 200);
    await drawComplete();
    expect(maps.sectors.size).toBe(1);

    // Draw inner square (pillar) inside the outer square
    await drawClick(50, 50);
    await drawClick(150, 50);
    await drawClick(150, 150);
    await drawClick(50, 150);
    await drawComplete();
    expect(maps.sectors.size).toBe(2);

    // The outer sector (donut) should have 2 loops
    const outerSid = findSectorAt(25, 25)!; // point in the donut ring
    expect(outerSid).toBeTruthy();

    const loops = buildSectorLoopIds(outerSid);
    expect(loops.length).toBe(2);

    // Sort loops by absolute area so we know which is outer vs inner
    const loopPolys = loops.map(l => loopToPoints(l));
    const areas = loopPolys.map(p => signedArea(p));

    const outerIdx = Math.abs(areas[0]) > Math.abs(areas[1]) ? 0 : 1;
    const innerIdx = 1 - outerIdx;

    // Outer loop (boundary) should be CCW (positive signed area)
    expect(areas[outerIdx]).toBeGreaterThan(0);
    // Inner loop (hole) should be CW (negative signed area)
    expect(areas[innerIdx]).toBeLessThan(0);
  });
});
