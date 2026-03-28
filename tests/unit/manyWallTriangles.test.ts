import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectNoSectorOverlaps } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {
    await drawClick(-272, 1040);
    await drawClick(160, 1008);
    await drawClick(144, 608);
    await drawClick(-288, 640);
    await drawClick(-272, 1040);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(-272, 1040);
    await drawClick(-80, 736);
    await drawClick(160, 1008);
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(5);
    expect(maps.linedefs.size).toBe(6);

    await drawClick(-272, 1040);
    await drawClick(-80, 976);
    await drawClick(160, 1008);
    expect(maps.sectors.size).toBe(3);
    expect(maps.vertices.size).toBe(6);
    expect(maps.linedefs.size).toBe(8);

    await drawClick(-272, 1040);
    await drawClick(-96, 944);
    await drawClick(160, 1008);
    expect(maps.sectors.size).toBe(4);
    expect(maps.vertices.size).toBe(7);
    expect(maps.linedefs.size).toBe(10);

    await drawClick(-272, 1040);
    await drawClick(-80, 832);
    await drawClick(160, 1008);
    expect(maps.sectors.size).toBe(5);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(12);

    expectNoSectorOverlaps();
  });
});
