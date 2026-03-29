import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('join lines', () => {
  it('should produce correct map state', async () => {
    await drawClick(-160, 1024);
    await drawClick(-480, 816);
    await drawClick(-144, 608);
    await drawComplete();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(3);
    expect(maps.linedefs.size).toBe(3);

    await drawClick(16, 1040);
    await drawClick(304, 848);
    await drawClick(16, 592);
    await drawComplete();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(6);
    expect(maps.linedefs.size).toBe(6);

    await bridgeLinedefs(findLinedefNear(-152, 816)!, findLinedefNear(16, 816)!);
    expect(maps.sectors.size).toBe(3);
    expect(maps.vertices.size).toBe(6);
    expect(maps.linedefs.size).toBe(8);

    dumpMapJSON('joinLines');
    expectMapIsValid();
  });
});
