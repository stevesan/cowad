import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';

import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON }  from './setup';
import { drawClick, drawComplete } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('splitDonutPillar', () => {
  it('should produce correct map state', async () => {
    await drawClick(0, 0);
    await drawClick(256, 0);
    await drawClick(256, 256);
    await drawClick(0, 256);
    await drawComplete();
    await drawClick(64, 64);
    await drawClick(192, 64);
    await drawClick(192, 192);
    await drawClick(64, 192);
    await drawComplete();
    setSelected({ type: 'sector', id: findSectorAt(128, 128)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    await drawClick(64, 192);
    await drawClick(0, 256);
    dumpMapJSON('splitDonutPillar');
    expect(maps.sectors.size).toBe(1);
    expectMapIsValid();
  });
});
