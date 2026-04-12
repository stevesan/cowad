import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';

import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON }  from './setup';
import { drawClick, drawComplete } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('bowtie', () => {
  it('should produce correct map state', async () => {
    await drawClick(-184, 296);
    await drawClick(192, 296);
    await drawClick(0, 32);
    await drawComplete();
    await drawClick(0, 32);
    await drawClick(-192, -184);
    await drawClick(160, -184);
    await drawComplete();
    dumpMapJSON('bowtie');
    expectMapIsValid();
  });
});
