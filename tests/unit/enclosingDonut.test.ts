import { describe, it, expect } from 'vitest';
import { maps, setSelected } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, expectMapIsValid } from './setup';
import { deleteSelected } from '../../src/map/mapActions';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {
    await drawClick(800, 1360);
    await drawClick(960, 1376);
    await drawClick(976, 1168);
    await drawClick(768, 1200);
    await drawComplete();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(592, 1616);
    await drawClick(1184, 1536);
    await drawClick(1184, 912);
    await drawClick(624, 992);
    await drawComplete();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    expectMapIsValid();
  });
});
