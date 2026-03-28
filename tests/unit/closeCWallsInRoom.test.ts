import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('close C-Walls in room', () => {
  it('should produce correct map state', async () => {
    await drawClick(-176, 224);
    await drawClick(352, 192);
    await drawClick(288, -160);
    await drawClick(-128, -176);
    await drawClick(-192, 224);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(16, 176);
    await drawClick(240, 80);
    await drawClick(0, -128);
    await drawClick(112, 48);
    await drawClick(16, 160);
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    setSelected({ type: 'sector', id: findSectorAt(117, 0)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    await drawClick(16, 176);
    await drawClick(0, -128);
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(9);

    dumpMapJSON('closeCWallsInRoom');
    expectMapIsValid();
  });
});
