import { describe, it, expect } from 'vitest';
import { maps, setSelected } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, expectNoSectorOverlaps } from './setup';
import { deleteSelected } from '../../src/map/mapActions';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {
    await drawClick(768, 1376);
    await drawClick(960, 1376);
    await drawClick(960, 1200);
    await drawClick(752, 1200);
    await drawComplete();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(768, 1376);
    await drawClick(864, 1280);
    await drawClick(960, 1376);
    await drawClick(768, 1376);
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(6);
    expect(maps.linedefs.size).toBe(7);

    await drawClick(768, 1376);
    await drawClick(864, 1328);
    await drawClick(960, 1376);
    expect(maps.sectors.size).toBe(3);
    expect(maps.vertices.size).toBe(7);
    expect(maps.linedefs.size).toBe(9);

    await drawClick(768, 1376);
    await drawClick(864, 1344);
    await drawClick(960, 1376);
    expect(maps.sectors.size).toBe(4);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(11);

    await drawClick(768, 1376);
    await drawClick(864, 1312);
    await drawClick(960, 1376);
    expect(maps.sectors.size).toBe(5);
    expect(maps.vertices.size).toBe(9);
    expect(maps.linedefs.size).toBe(13);

    expectNoSectorOverlaps();
  });
});
