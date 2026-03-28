import { describe, it, expect } from 'vitest';
import { maps, setSelected } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { expectMapIsValid } from './setup';
import { deleteSelected } from '../../src/map/mapActions';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {
    await drawClick(768, 1392);
    await drawClick(1040, 1392);
    await drawClick(1024, 1104);
    await drawClick(720, 1136);
    await drawComplete();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(816, 1360);
    await drawClick(960, 1264);
    await drawClick(768, 1136);
    await drawClick(880, 1280);
    await drawComplete();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    await drawClick(816, 1360);
    await drawClick(768, 1136);
    expect(maps.sectors.size).toBe(3);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(9);

    expectMapIsValid();
  });
});
