import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';

import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON }  from './setup';
import { drawClick, drawComplete } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {
    await drawClick(16, 512);
    await drawClick(720, 512);
    await drawClick(768, -224);
    await drawClick(0, -192);
    await drawComplete();
    await drawClick(176, 368);
    await drawClick(608, 224);
    await drawClick(160, -144);
    await drawComplete();
    await drawClick(176, 368);
    await drawClick(496, 416);
    await drawClick(608, 224);
    dumpMapJSON('extendCInRoom');
    expect(maps.sectors.size).toBe(3);
    expectMapIsValid();
  });
});
