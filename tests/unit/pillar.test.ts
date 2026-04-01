import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('pillar', () => {
  it('should produce correct map state', async () => {
    await drawClick(-256, 176);
    await drawClick(192, 176);
    await drawClick(192, -288);
    await drawClick(-256, -304);
    await drawComplete();
    await drawClick(-112, 80);
    await drawClick(64, 80);
    await drawClick(48, -112);
    await drawClick(-96, -112);
    await drawComplete();
    setSelected({ type: 'sector', id: findSectorAt(-24, -16)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    expectMapIsValid();
  });
});
