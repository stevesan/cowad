import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('splitAndExtend', () => {
  it('should produce correct map state', async () => {
    await drawClick(-208, 240);
    await drawClick(104, 240);
    await drawClick(128, -72);
    await drawClick(-152, -48);
    await drawComplete();
    await drawClick(-208, 240);
    await drawClick(128, -72);
    await drawClick(-208, 240);
    await drawClick(-40, 336);
    await drawClick(-208, 240);
    await drawClick(272, 360);
    await drawClick(128, -72);
    dumpMapJSON('splitAndExtend');
    expect(maps.sectors.size).toBe(3);
    expectMapIsValid();
  });
});
