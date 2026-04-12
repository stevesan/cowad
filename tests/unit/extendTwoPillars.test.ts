import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';

import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON }  from './setup';
import { drawClick, drawComplete } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('extend two pillars', () => {
  it('should produce correct map state', async () => {
    await drawClick(-224, 304);
    await drawClick(752, 304);
    await drawClick(768, -464);
    await drawClick(-352, -304);
    await drawComplete();
    await drawClick(-32, 128);
    await drawClick(176, 112);
    await drawClick(32, -64);
    await drawComplete();
    await drawClick(336, 96);
    await drawClick(592, 80);
    await drawClick(432, -160);
    await drawComplete();
    setSelected({ type: 'sector', id: findSectorAt(453.3333333333333, 5.333333333333333)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(10);
    expect(maps.linedefs.size).toBe(10);

    setSelected({ type: 'sector', id: findSectorAt(58.666666666666664, 58.666666666666664)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(10);
    expect(maps.linedefs.size).toBe(10);

    await drawClick(-32, 128);
    await drawClick(128, 224);
    await drawClick(176, 112);
    await drawClick(336, 96);
    await drawClick(480, 224);
    await drawClick(592, 80);
    dumpMapJSON('extendTwoPillars');
    expect(maps.sectors.size).toBe(3);
    expectMapIsValid();
  });
});
