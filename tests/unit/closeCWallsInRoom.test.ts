import { describe, it, expect } from 'vitest';
import { maps, setSelected, setMultiSelected, multiSelectType } from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findVertexAt, findSectorAt, findLinedefNear, expectNoSectorOverlaps } from './setup';
import { deleteSelected, deleteMultiSelected, mergeVertices, mergeSectors, bridgeLinedefs, placeThing, splitLinedefAtPoint } from '../../src/map/mapActions';

describe('recorded test case', () => {
  it('should produce correct map state', async () => {
    await drawClick(1584, 1424);
    await drawClick(1920, 1424);
    await drawClick(1920, 1088);
    await drawClick(1584, 1072);
    await drawClick(1584, 1408);
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(4);
    expect(maps.linedefs.size).toBe(4);

    await drawClick(1680, 1360);
    await drawClick(1840, 1280);
    await drawClick(1712, 1120);
    await drawClick(1760, 1248);
    await drawClick(1680, 1360);
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    setSelected({ type: 'sector', id: findSectorAt(1748, 1252)! });
    deleteSelected();
    expect(maps.sectors.size).toBe(1);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(8);

    await drawClick(1680, 1360);
    await drawClick(1712, 1120);
    expect(maps.sectors.size).toBe(2);
    expect(maps.vertices.size).toBe(8);
    expect(maps.linedefs.size).toBe(9);

    expectNoSectorOverlaps();
  });
});
