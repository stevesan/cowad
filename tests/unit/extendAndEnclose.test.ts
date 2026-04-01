import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('extendAndEnclose', () => {
  it('should produce correct map state', async () => {
    await drawClick(-192, 256);
    await drawClick(-144, -384);
    await drawClick(-368, -16);
    await drawComplete();
    await drawClick(-112, 96);
    await drawClick(0, -16);
    await drawClick(-96, -208);
    await drawClick(-96, 96);
    await drawClick(-192, 256);
    await drawClick(176, -16);
    await drawClick(-144, -384);
    dumpMapJSON('extendAndEnclose');
    expectMapIsValid();
  });
});
