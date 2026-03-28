import { describe, it, expect } from 'vitest';
import { maps } from '../../src/state/appState';
import { findVertexAt, findSectorAt, expectNoSectorOverlaps } from './setup';
import { createSectorFromPolygon, splitSector, deleteSelected } from '../../src/map/mapActions';
import { setSelected } from '../../src/state/appState';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {

    // Step 1: create sector
    const sid1 = await createSectorFromPolygon([
      { x: 576, y: 1232 },
      { x: 816, y: 1248 },
      { x: 800, y: 1008 },
      { x: 592, y: 1008 },
    ]);
    expect(sid1).toBeTruthy();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    // Step 2: create sector
    const sid2 = await createSectorFromPolygon([
      { x: 656, y: 1216 },
      { x: 752, y: 1152 },
      { x: 656, y: 1040 },
      { x: 704, y: 1136 },
    ]);
    expect(sid2).toBeTruthy();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    // Step 3: split sector
    const splitTarget3 = findSectorAt(692, 1136)!;
    expect(splitTarget3).toBeTruthy();
    const [kept3, new3] = (await splitSector([
      { x: 656, y: 1216, existingId: findVertexAt(656, 1216)! },
      { x: 656, y: 1040, existingId: findVertexAt(656, 1040)! },
    ], splitTarget3))!;
    expect(maps.sectors.size).toBe(3);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(9);
  });

  expectNoSectorOverlaps();
});
