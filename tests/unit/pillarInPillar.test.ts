import { describe, it, expect } from 'vitest';
import { maps, setSelected } from '../../src/state/appState';

import { findVertexAt, findSectorAt, expectMapIsValid, dumpMapJSON }  from './setup';
import { drawClick, drawComplete } from './setup';
import { deleteSelected } from '../../src/map/mapActions';

describe('pillar in pillar', () => {
  it('should produce correct map state', async () => {
    await drawClick(736, 1360);
    await drawClick(1152, 1376);
    await drawClick(1136, 1008);
    await drawClick(720, 992);
    await drawComplete();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(864, 1280);
    await drawClick(1024, 1280);
    await drawClick(1008, 1104);
    await drawClick(816, 1104);
    await drawComplete();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    setSelected({ type: 'sector', id: findSectorAt(928, 1192)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    await drawClick(912, 1248);
    await drawClick(976, 1232);
    await drawClick(912, 1152);
    await drawComplete();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(11);
    expect(maps.linedefs.size).toBe(11);

    dumpMapJSON('pillarInPillar');
    expectMapIsValid();
  });
});
