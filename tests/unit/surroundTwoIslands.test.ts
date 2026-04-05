import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('surroundTwoIslands', () => {
  it('should produce correct map state', async () => {
    await drawClick(-224, 256);
    await drawClick(368, 256);
    await drawClick(336, -192);
    await drawClick(-288, -160);
    await drawComplete();
    await drawClick(-96, 64);
    await drawClick(32, 16);
    await drawClick(-80, -32);
    await drawComplete();
    await drawClick(160, 48);
    await drawClick(224, 64);
    await drawClick(144, -32);
    await drawComplete();
    await drawClick(-144, 128);
    await drawClick(176, 160);
    await drawClick(288, 64);
    await drawClick(224, -48);
    await drawClick(-144, -96);
    await drawComplete();
    dumpMapJSON('surroundTwoIslands');
    expect(maps.sectors.size).toBe(4);
    expectMapIsValid();
  });
});
