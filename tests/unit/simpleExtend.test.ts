import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('simpleExtend', () => {
  it('should produce correct map state', async () => {
    await drawClick(-256, 184);
    await drawClick(-504, 56);
    await drawClick(-240, -168);
    await drawComplete();
    await drawClick(-256, 184);
    await drawClick(-16, 64);
    await drawClick(-240, -168);
    dumpMapJSON('simpleextend');
    expectMapIsValid();
  });
});
