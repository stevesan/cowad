import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';

import { findVertexAt, findSectorAt, findLinedefNear, expectMapIsValid, dumpMapJSON }  from './setup';
import { drawClick, drawComplete } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('map01', () => {
  it('should produce correct map state', async () => {
    await drawClick(-160, 176);
    await drawClick(224, 160);
    await drawClick(208, -96);
    await drawClick(-176, -64);
    await drawClick(-160, 176);
    splitLinedefAtPoint(findLinedefNear(32, 168)!, -112, 176);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(5);
    expect(maps.linedefs.size).toBe(5);

    splitLinedefAtPoint(findLinedefNear(56, 168)!, -64, 176);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(6);
    expect(maps.linedefs.size).toBe(6);

    splitLinedefAtPoint(findLinedefNear(80, 168)!, 80, 160);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(7);
    expect(maps.linedefs.size).toBe(7);

    splitLinedefAtPoint(findLinedefNear(152, 160)!, 176, 160);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    
    await drawClick(-112, 176);
    await drawClick(32, -64);
    await drawClick(176, 160);
    expect(maps.sectors.size).toBe(2);
    
    await drawClick(-64, 176);
    await drawClick(32, 16);
    await drawClick(80, 160);
    expect(maps.sectors.size).toBe(3);

    dumpMapJSON('map01-before-last-sector');

    await drawClick(-64, 176);
    await drawClick(-64, 320);
    await drawClick(256, 336);
    await drawClick(176, 208);
    await drawClick(64, 240);
    await drawClick(80, 160);
    dumpMapJSON('map01');
    expectMapIsValid();
  });
});
