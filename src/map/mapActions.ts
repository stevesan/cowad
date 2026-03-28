import { mapRef } from '../config/firebase';
import { maps, selected, setSelected, multiSelected, multiSelectType, setMultiSelected, mouseWorld, triggerRenderPanel, triggerDraw } from '../state/appState';
import { buildSectorLoopIds } from '../geometry/cycleFinder';
import { pointInPoly, polyArea, segmentsProperlyIntersect } from '../geometry/hitTest';
import { isCCW, computeTestPoint, buildSplitPaths } from '../geometry/polygonMath';
import { findExistingLinedef, findEnclosingSector, mergeWouldDuplicate } from '../geometry/sectorQueries';
import { findBoundaryPath } from '../state/indices';
import { beginAction, record, endAction } from '../history/undoRedo';
import { showToast } from '../ui/toast';
import { getSelectedThingType } from '../ui/thingBrowser';
import type { DrawVertex, Linedef, Point } from '../types';
import { recordSectorDone, recordDeleteBefore, recordDeleteDone, recordMergeVertices, recordMergeSectors, recordBridgeLinedefs, recordPlaceThing, recordSplitLinedef, recordDeleteMultiSelected } from '../testing/recorder';

export function placeThing(wx: number, wy: number): void {
  const type = getSelectedThingType();
  const val = { x: wx, y: wy, angle: 0, type, flags: 7 };
  const ref = mapRef('things').push(val);
  record(`map/things/${ref.key}`, null, val);
  recordPlaceThing(wx, wy);
}

export function splitLinedefAtPoint(lid: string, wx: number, wy: number): void {
  const ld = maps.linedefs.get(lid);
  if (!ld) return;
  const v1 = maps.vertices.get(ld.v1);
  const v2 = maps.vertices.get(ld.v2);
  if (!v1 || !v2) return;
  if ((wx === v1.x && wy === v1.y) || (wx === v2.x && wy === v2.y)) return;

  recordSplitLinedef(lid, wx, wy);
  beginAction();

  // Create new vertex at split point
  const vVal = { x: wx, y: wy };
  const vRef = mapRef('vertices').push(vVal);
  const midVid = vRef.key;
  record(`map/vertices/${midVid}`, null, vVal);

  // Capture original state
  const origV2 = ld.v2;
  const ldBefore = { ...ld };

  // Shorten original linedef: v1→mid
  record(`map/linedefs/${lid}`, ldBefore, { ...ldBefore, v2: midVid });
  mapRef('linedefs').child(lid).update({ v2: midVid });

  // Create new linedef: mid→origV2 with copied sidedefs
  const newLd: any = { v1: midVid, v2: origV2, flags: ldBefore.flags };
  if (ldBefore.special) newLd.special = ldBefore.special;
  if (ldBefore.tag) newLd.tag = ldBefore.tag;

  if (ldBefore.frontSide) {
    const fsd = maps.sidedefs.get(ldBefore.frontSide);
    if (fsd) {
      const newFsd = { ...fsd };
      const fsdRef = mapRef('sidedefs').push(newFsd);
      record(`map/sidedefs/${fsdRef.key}`, null, newFsd);
      newLd.frontSide = fsdRef.key;
    }
  }

  if (ldBefore.backSide) {
    const bsd = maps.sidedefs.get(ldBefore.backSide);
    if (bsd) {
      const newBsd = { ...bsd };
      const bsdRef = mapRef('sidedefs').push(newBsd);
      record(`map/sidedefs/${bsdRef.key}`, null, newBsd);
      newLd.backSide = bsdRef.key;
    }
  }

  const newLdRef = mapRef('linedefs').push(newLd);
  record(`map/linedefs/${newLdRef.key}`, null, newLd);

  endAction();

  setSelected({ type: 'vertex', id: midVid });
  triggerRenderPanel();
}

export function mergeVertices(): void {
  if (multiSelected.size !== 2) {
    showToast('Select exactly 2 vertices to merge');
    return;
  }

  const [vidA, vidB] = [...multiSelected];
  const vA = maps.vertices.get(vidA);
  const vB = maps.vertices.get(vidB);
  if (!vA || !vB) return;

  // Find the linedef connecting them (they must be adjacent)
  const connecting = findExistingLinedef(maps.linedefs, vidA, vidB);
  if (!connecting) {
    showToast('Vertices must be connected by a linedef');
    return;
  }
  const connectingLid = connecting.ldId;

  if (mergeWouldDuplicate(maps.linedefs, vidA, vidB, connectingLid)) {
    showToast('Merge would create duplicate linedefs');
    return;
  }

  recordMergeVertices(vidA, vidB);
  beginAction();

  // Move B to whichever input vertex is closest to the cursor
  const dA = Math.hypot(vA.x - mouseWorld.x, vA.y - mouseWorld.y);
  const dB = Math.hypot(vB.x - mouseWorld.x, vB.y - mouseWorld.y);
  const target = dA < dB ? vA : vB;
  if (target !== vB) {
    record(`map/vertices/${vidB}`, { ...vB }, { x: target.x, y: target.y });
    mapRef('vertices').child(vidB).update({ x: target.x, y: target.y });
  }

  // Delete the connecting linedef (and its sidedefs)
  deleteLinedef(connectingLid);

  // Rewrite all linedefs referencing A to reference B
  maps.linedefs.forEach((ld, lid) => {
    const updates: Record<string, any> = {};
    if (ld.v1 === vidA) updates.v1 = vidB;
    if (ld.v2 === vidA) updates.v2 = vidB;
    if (Object.keys(updates).length) {
      record(`map/linedefs/${lid}`, { ...ld }, { ...ld, ...updates });
      mapRef('linedefs').child(lid).update(updates);
    }
  });

  // Delete vertex A
  record(`map/vertices/${vidA}`, { ...vA }, null);
  mapRef('vertices').child(vidA).remove();

  endAction();

  setMultiSelected(new Set([vidB]));
  setSelected({ type: 'vertex', id: vidB });
  triggerRenderPanel();
  triggerDraw();
}

export function mergeSectors(): void {
  if (multiSelectType !== 'sector' || multiSelected.size < 2) {
    showToast('Select 2 or more sectors to merge');
    return;
  }

  const sids = [...multiSelected];
  const keepSid = sids[sids.length - 1]; // keep the last selected
  const removeSids = new Set(sids.slice(0, -1));

  recordMergeSectors(sids);
  beginAction();

  // Repoint all sidedefs referencing removed sectors to the kept sector
  maps.sidedefs.forEach((sd, sdid) => {
    if (sd.sector && removeSids.has(sd.sector)) {
      record(`map/sidedefs/${sdid}`, { ...sd }, { ...sd, sector: keepSid });
      mapRef('sidedefs').child(sdid).update({ sector: keepSid });
    }
  });

  // Delete linedefs where both sides now reference the same sector (internal boundaries)
  // Collect first since we modify during iteration
  const toDelete: string[] = [];
  maps.linedefs.forEach((ld, lid) => {
    if (!ld.frontSide || !ld.backSide) return;
    const frontSd = maps.sidedefs.get(ld.frontSide);
    const backSd = maps.sidedefs.get(ld.backSide);
    if (frontSd?.sector === keepSid && backSd?.sector === keepSid) {
      toDelete.push(lid);
    }
  });
  for (const lid of toDelete) {
    deleteLinedef(lid);
  }

  // Remove orphaned vertices (connected to no linedefs)
  const usedVerts = new Set<string>();
  maps.linedefs.forEach(ld => { usedVerts.add(ld.v1); usedVerts.add(ld.v2); });
  maps.vertices.forEach((v, vid) => {
    if (!usedVerts.has(vid)) {
      record(`map/vertices/${vid}`, { ...v }, null);
      mapRef('vertices').child(vid).remove();
    }
  });

  // Delete the removed sectors
  for (const sid of removeSids) {
    const sec = maps.sectors.get(sid);
    if (sec) {
      record(`map/sectors/${sid}`, { ...sec }, null);
      mapRef('sectors').child(sid).remove();
    }
  }

  endAction();

  setMultiSelected(new Set());
  setSelected({ type: 'sector', id: keepSid });
  triggerRenderPanel();
  triggerDraw();
}

export function deleteLinedef(lid: string): void {
  const ld = maps.linedefs.get(lid);
  if (!ld) return;
  if (ld.frontSide) {
    const sd = maps.sidedefs.get(ld.frontSide);
    if (sd) record(`map/sidedefs/${ld.frontSide}`, { ...sd }, null);
    mapRef('sidedefs').child(ld.frontSide).remove();
  }
  if (ld.backSide) {
    const sd = maps.sidedefs.get(ld.backSide);
    if (sd) record(`map/sidedefs/${ld.backSide}`, { ...sd }, null);
    mapRef('sidedefs').child(ld.backSide).remove();
  }
  record(`map/linedefs/${lid}`, { ...ld }, null);
  mapRef('linedefs').child(lid).remove();
}

export function deleteSelected(): void {
  if (!selected) return;
  recordDeleteBefore(selected.type, selected.id);
  beginAction();
  const { type, id } = selected;
  if (type === 'vertex') {
    const lines: string[] = [];
    maps.linedefs.forEach((ld, lid) => { if (ld.v1 === id || ld.v2 === id) lines.push(lid); });
    lines.forEach(deleteLinedef);
    const v = maps.vertices.get(id);
    if (v) record(`map/vertices/${id}`, { ...v }, null);
    mapRef('vertices').child(id).remove();
  } else if (type === 'linedef') {
    deleteLinedef(id);
  } else if (type === 'sector') {
    // Find all sidedefs belonging to this sector
    const sectorSdIds = new Set<string>();
    maps.sidedefs.forEach((sd, sdid) => {
      if (sd.sector === id) sectorSdIds.add(sdid);
    });

    // For each linedef referencing these sidedefs, clean up
    maps.linedefs.forEach((ld, lid) => {
      const frontBelongs = ld.frontSide && sectorSdIds.has(ld.frontSide);
      const backBelongs = ld.backSide && sectorSdIds.has(ld.backSide);
      if (!frontBelongs && !backBelongs) return;

      const ldBefore = { ...ld };

      if (frontBelongs && backBelongs) {
        // Both sides belong to deleted sector — remove entire linedef and both sidedefs
        const fsd = maps.sidedefs.get(ld.frontSide!);
        if (fsd) record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, null);
        mapRef('sidedefs').child(ld.frontSide!).remove();
        const bsd = maps.sidedefs.get(ld.backSide!);
        if (bsd) record(`map/sidedefs/${ld.backSide}`, { ...bsd }, null);
        mapRef('sidedefs').child(ld.backSide!).remove();
        record(`map/linedefs/${lid}`, ldBefore, null);
        mapRef('linedefs').child(lid).remove();
        // Remove orphaned vertices
        for (const vid of [ld.v1, ld.v2]) {
          let used = false;
          maps.linedefs.forEach((other, olid) => {
            if (olid !== lid && (other.v1 === vid || other.v2 === vid)) used = true;
          });
          if (!used) {
            const v = maps.vertices.get(vid);
            if (v) record(`map/vertices/${vid}`, { ...v }, null);
            mapRef('vertices').child(vid).remove();
          }
        }
      } else if (frontBelongs) {
        // Front belongs to deleted sector, back stays — remove front sidedef
        const fsd = maps.sidedefs.get(ld.frontSide!);
        if (fsd) record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, null);
        mapRef('sidedefs').child(ld.frontSide!).remove();
        if (ld.backSide) {
          // Swap back to front, make single-sided
          const updates: Record<string, any> = {
            frontSide: ld.backSide, backSide: null,
            v1: ld.v2, v2: ld.v1,
            flags: ((ld.flags ?? 1) & ~4) | 1,
          };
          record(`map/linedefs/${lid}`, ldBefore, { ...ldBefore, ...updates });
          mapRef('linedefs').child(lid).update(updates);
          // Restore mid texture on the remaining sidedef
          const bsd = maps.sidedefs.get(ld.backSide);
          if (bsd && (!bsd.mid || bsd.mid === '-')) {
            record(`map/sidedefs/${ld.backSide}`, { ...bsd }, { ...bsd, mid: 'STARTAN2' });
            mapRef('sidedefs').child(ld.backSide).update({ mid: 'STARTAN2' });
          }
        } else {
          // No back side either — remove linedef entirely
          record(`map/linedefs/${lid}`, ldBefore, null);
          mapRef('linedefs').child(lid).remove();
        }
      } else if (backBelongs) {
        // Back belongs to deleted sector, front stays — remove back sidedef, make single-sided
        const bsd = maps.sidedefs.get(ld.backSide!);
        if (bsd) record(`map/sidedefs/${ld.backSide}`, { ...bsd }, null);
        mapRef('sidedefs').child(ld.backSide!).remove();
        const updates: Record<string, any> = {
          backSide: null,
          flags: ((ld.flags ?? 1) & ~4) | 1,
        };
        record(`map/linedefs/${lid}`, ldBefore, { ...ldBefore, ...updates });
        mapRef('linedefs').child(lid).update(updates);
        // Restore mid texture on the remaining front sidedef
        const fsd = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
        if (fsd && (!fsd.mid || fsd.mid === '-')) {
          record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, { ...fsd, mid: 'STARTAN2' });
          mapRef('sidedefs').child(ld.frontSide!).update({ mid: 'STARTAN2' });
        }
      }
    });

    const sec = maps.sectors.get(id);
    if (sec) record(`map/sectors/${id}`, { ...sec }, null);
    mapRef('sectors').child(id).remove();
  } else if (type === 'thing') {
    const th = maps.things.get(id);
    if (th) record(`map/things/${id}`, { ...th }, null);
    mapRef('things').child(id).remove();
  }
  endAction();
  recordDeleteDone();
  setSelected(null);
  triggerRenderPanel();
}

export function deleteMultiSelected(): void {
  if (multiSelected.size === 0) return;

  recordDeleteMultiSelected(multiSelected);
  beginAction();

  const vidsToDelete = new Set(multiSelected);

  // Find all linedefs touching any of these vertices
  const lidsToDelete = new Set<string>();
  maps.linedefs.forEach((ld, lid) => {
    if (vidsToDelete.has(ld.v1) || vidsToDelete.has(ld.v2)) lidsToDelete.add(lid);
  });

  // Collect sidedefs and sectors that will be orphaned
  const sdidsToDelete = new Set<string>();
  const sectorRefCounts = new Map<string, number>();

  // Count how many sidedefs reference each sector (only from linedefs NOT being deleted)
  maps.linedefs.forEach((ld, lid) => {
    if (lidsToDelete.has(lid)) return;
    for (const sdId of [ld.frontSide, ld.backSide]) {
      if (!sdId) continue;
      const sd = maps.sidedefs.get(sdId);
      if (sd?.sector) sectorRefCounts.set(sd.sector, (sectorRefCounts.get(sd.sector) ?? 0) + 1);
    }
  });

  // Delete linedefs and their sidedefs
  for (const lid of lidsToDelete) {
    const ld = maps.linedefs.get(lid);
    if (!ld) continue;
    if (ld.frontSide) {
      const sd = maps.sidedefs.get(ld.frontSide);
      if (sd) {
        record(`map/sidedefs/${ld.frontSide}`, { ...sd }, null);
        sdidsToDelete.add(ld.frontSide);
      }
      mapRef('sidedefs').child(ld.frontSide).remove();
    }
    if (ld.backSide) {
      const sd = maps.sidedefs.get(ld.backSide);
      if (sd) {
        record(`map/sidedefs/${ld.backSide}`, { ...sd }, null);
        sdidsToDelete.add(ld.backSide);
      }
      mapRef('sidedefs').child(ld.backSide).remove();
    }
    record(`map/linedefs/${lid}`, { ...ld }, null);
    mapRef('linedefs').child(lid).remove();
  }

  // Delete vertices
  for (const vid of vidsToDelete) {
    const v = maps.vertices.get(vid);
    if (v) record(`map/vertices/${vid}`, { ...v }, null);
    mapRef('vertices').child(vid).remove();
  }

  // Delete orphaned sectors (no remaining sidedefs reference them)
  const orphanedSectors = new Set<string>();
  maps.sectors.forEach((_, sid) => {
    if (!sectorRefCounts.has(sid) || sectorRefCounts.get(sid) === 0) {
      orphanedSectors.add(sid);
    }
  });
  for (const sid of orphanedSectors) {
    const sec = maps.sectors.get(sid);
    if (sec) record(`map/sectors/${sid}`, { ...sec }, null);
    mapRef('sectors').child(sid).remove();
  }

  endAction();

  setMultiSelected(new Set());
  setSelected(null);
  triggerRenderPanel();
  triggerDraw();
}

/**
 * Expand a polygon chain by inserting intermediate boundary vertices
 * between consecutive existing vertices that lack a usable direct linedef.
 * Handles: (1) no direct linedef at all, (2) direct linedef with both sides occupied.
 * When two boundary paths exist, picks the one creating the smaller polygon.
 */
function expandMissingEdges(chain: DrawVertex[]): DrawVertex[] {
  const result: DrawVertex[] = [];
  const n = chain.length;

  for (let i = 0; i < n; i++) {
    result.push(chain[i]);
    const va = chain[i];
    const vb = chain[(i + 1) % n];

    if (!va.existingId || !vb.existingId) continue;
    if (va.existingId === vb.existingId) continue;

    // Check if direct linedef exists and is usable (has a free side)
    const existing = findExistingLinedef(maps.linedefs, va.existingId, vb.existingId);
    if (existing) {
      const ld = maps.linedefs.get(existing.ldId);
      if (ld && (!ld.frontSide || !ld.backSide)) continue; // has free side, OK
      // Both sides occupied — fall through to find alternate path
    } else {
      // No direct linedef at all — fall through
    }

    // Try BFS in both directions to get two candidate paths
    const fwd = findBoundaryPath(va.existingId, vb.existingId);
    const rev = findBoundaryPath(vb.existingId, va.existingId);
    const revReversed = rev ? [...rev].reverse() : null;

    let intermediates: string[] | null = null;

    if (fwd && fwd.length > 0 && revReversed && revReversed.length > 0
        && fwd.join(',') !== revReversed.join(',')) {
      // Two different paths — pick the one creating the smaller polygon
      const buildPoly = (ints: string[]): Point[] => {
        const pts: Point[] = [];
        for (let j = 0; j < n; j++) {
          pts.push({ x: chain[j].x, y: chain[j].y });
          if (j === i) {
            for (const vid of ints) {
              const v = maps.vertices.get(vid);
              if (v) pts.push(v);
            }
          }
        }
        return pts;
      };
      const areaFwd = polyArea(buildPoly(fwd));
      const areaRev = polyArea(buildPoly(revReversed));
      intermediates = areaFwd <= areaRev ? fwd : revReversed;
    } else {
      intermediates = (fwd && fwd.length > 0) ? fwd : revReversed;
    }

    if (intermediates) {
      for (const vid of intermediates) {
        const v = maps.vertices.get(vid);
        if (v) result.push({ x: v.x, y: v.y, existingId: vid });
      }
    }
  }

  return result;
}

export async function createSectorFromPolygon(chain: DrawVertex[], skipExpansion = false): Promise<string | null> {
  if (!skipExpansion) chain = expandMissingEdges(chain);
  const n = chain.length;
  if (n < 3) return null;

  beginAction();

  // 1. Create vertices for new points, reuse existing
  const vertexIds: string[] = [];
  for (const pt of chain) {
    if (pt.existingId) {
      vertexIds.push(pt.existingId);
    } else {
      const val = { x: pt.x, y: pt.y };
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      vertexIds.push(ref.key);
    }
  }

  // 2. Compute winding order
  const ccw = isCCW(chain);

  // 3. Find or create linedefs for each edge; detect template sector from shared lines
  let templateSector: Record<string, any> | null = null;
  interface EdgeInfo { ldId: string; isNew: boolean; sameDirection: boolean; }
  const edges: EdgeInfo[] = [];
  const newLdData = new Map<string, any>();

  for (let i = 0; i < n; i++) {
    const va = vertexIds[i], vb = vertexIds[(i + 1) % n];
    const existing = findExistingLinedef(maps.linedefs, va, vb);

    if (existing) {
      edges.push({ ldId: existing.ldId, isNew: false, sameDirection: existing.sameDirection });
      if (!templateSector) {
        const ld = maps.linedefs.get(existing.ldId)!;
        const sdId = ld.frontSide || ld.backSide;
        const sd = sdId ? maps.sidedefs.get(sdId) : null;
        if (sd?.sector) {
          const sec = maps.sectors.get(sd.sector);
          if (sec) templateSector = { ...sec };
        }
      }
    } else {
      // Orient new linedef so front side faces polygon interior
      const v1 = ccw ? vb : va;
      const v2 = ccw ? va : vb;
      const ldVal = { v1, v2, flags: 1 };
      const ref = mapRef('linedefs').push(ldVal);
      record(`map/linedefs/${ref.key}`, null, ldVal);
      edges.push({ ldId: ref.key, isNew: true, sameDirection: false });
      newLdData.set(ref.key, ldVal);
    }
  }

  // 4. Always find enclosing sector (needed for correct topology even when sharing lines)
  const testPt = computeTestPoint(chain);
  let enclosingSectorId = findEnclosingSector(testPt.x, testPt.y, maps.sectors.keys());
  if (!templateSector && enclosingSectorId) {
    templateSector = { ...maps.sectors.get(enclosingSectorId)! };
  }

  // 5. Create sector
  const secProps = templateSector
    ? { floor: templateSector.floor, ceiling: templateSector.ceiling, light: templateSector.light, special: templateSector.special || 0, tag: templateSector.tag || 0, floorTex: templateSector.floorTex || 'FLOOR4_8', ceilTex: templateSector.ceilTex || 'CEIL3_5' }
    : { floor: 0, ceiling: 128, light: 160, special: 0, tag: 0, floorTex: 'FLOOR4_8', ceilTex: 'CEIL3_5' };

  const secRef = await mapRef('sectors').push(secProps);
  const sid = secRef.key;
  record(`map/sectors/${sid}`, null, secProps);

  // 6. Create sidedefs and link to linedefs
  for (let i = 0; i < n; i++) {
    const edge = edges[i];
    const ld: Linedef | undefined = maps.linedefs.get(edge.ldId) || newLdData.get(edge.ldId);
    if (!ld) continue;

    let useFront: boolean;
    if (edge.isNew) {
      useFront = true; // new linedefs are oriented so front = interior
    } else {
      // Both sides occupied — find the enclosing sector's side and reassign it
      if (ld.frontSide && ld.backSide && enclosingSectorId) {
        const fsd = maps.sidedefs.get(ld.frontSide);
        const bsd = maps.sidedefs.get(ld.backSide);
        if (fsd && fsd.sector === enclosingSectorId) {
          record(`map/sidedefs/${ld.frontSide}`, { ...fsd }, { ...fsd, sector: sid });
          await mapRef('sidedefs').child(ld.frontSide).update({ sector: sid });
        } else if (bsd && bsd.sector === enclosingSectorId) {
          record(`map/sidedefs/${ld.backSide}`, { ...bsd }, { ...bsd, sector: sid });
          await mapRef('sidedefs').child(ld.backSide).update({ sector: sid });
        }
        continue;
      }
      // One side free — use winding to pick the correct side
      useFront = edge.sameDirection !== ccw;
      if (useFront && ld.frontSide) continue;
      if (!useFront && ld.backSide) continue;
    }

    const becomingTwoSided = (useFront ? !!ld.backSide : !!ld.frontSide)
      || (edge.isNew && !!enclosingSectorId);

    const sdVal = {
      sector: sid, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: becomingTwoSided ? '-' : 'STARTAN2', lower: 'STARTAN2',
    };
    const sdRef = await mapRef('sidedefs').push(sdVal);
    record(`map/sidedefs/${sdRef.key}`, null, sdVal);

    const updates: Record<string, any> = useFront ? { frontSide: sdRef.key } : { backSide: sdRef.key };

    // New linedef inside an enclosing sector: create back sidedef for the enclosing sector
    if (edge.isNew && enclosingSectorId) {
      const backSdVal = {
        sector: enclosingSectorId, xoff: 0, yoff: 0,
        upper: 'STARTAN2', mid: '-', lower: 'STARTAN2',
      };
      const backSdRef = await mapRef('sidedefs').push(backSdVal);
      record(`map/sidedefs/${backSdRef.key}`, null, backSdVal);
      updates.backSide = backSdRef.key;
      updates.flags = ((ld.flags ?? 1) | 4) & ~1;
    } else if (becomingTwoSided) {
      updates.flags = ((ld.flags ?? 1) | 4) & ~1;
      const existingSdId = useFront ? ld.backSide : ld.frontSide;
      const existingSd = existingSdId ? maps.sidedefs.get(existingSdId) : null;
      if (existingSd) {
        const sdFix: Record<string, any> = {};
        if (!existingSd.upper || existingSd.upper === '-') sdFix.upper = 'STARTAN2';
        if (!existingSd.lower || existingSd.lower === '-') sdFix.lower = 'STARTAN2';
        sdFix.mid = '-';
        record(`map/sidedefs/${existingSdId}`, { ...existingSd }, { ...existingSd, ...sdFix });
        await mapRef('sidedefs').child(existingSdId!).update(sdFix);
      }
    }

    const ldBefore = maps.linedefs.get(edge.ldId) || newLdData.get(edge.ldId);
    if (ldBefore) record(`map/linedefs/${edge.ldId}`, { ...ldBefore }, { ...ldBefore, ...updates });
    await mapRef('linedefs').child(edge.ldId).update(updates);
  }

  setSelected({ type: 'sector', id: sid });
  triggerRenderPanel();
  endAction();
  recordSectorDone();
  return sid;
}

export async function splitSector(chain: DrawVertex[], sectorId: string): Promise<[string, string] | null> {
  const n = chain.length;
  if (n < 2) return null;
  const startVid = chain[0].existingId!;
  const endVid = chain[n - 1].existingId!;

  // Capture loops BEFORE modifications
  const loops = buildSectorLoopIds(sectorId);
  let targetLoop: string[] | null = null;
  for (const loop of loops) {
    if (loop.includes(startVid) && loop.includes(endVid)) {
      targetLoop = loop;
      break;
    }
  }
  if (!targetLoop) return null;

  const { path1, path2 } = buildSplitPaths(targetLoop, startVid, endVid);

  beginAction();

  // 1. Create vertices for chain intermediates
  const chainVids: string[] = [startVid];
  for (let i = 1; i < n - 1; i++) {
    const pt = chain[i];
    if (pt.existingId) {
      chainVids.push(pt.existingId);
    } else {
      const val = { x: pt.x, y: pt.y };
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      chainVids.push(ref.key);
    }
  }
  chainVids.push(endVid);

  // 2. Create new sector with same properties
  const origSec = maps.sectors.get(sectorId)!;
  const secProps = { ...origSec };
  const secRef = await mapRef('sectors').push(secProps);
  const newSid = secRef.key;
  record(`map/sectors/${newSid}`, null, secProps);

  // 3. Reassign path1 edges: change sidedefs from original to new sector
  for (let i = 0; i < path1.length - 1; i++) {
    const found = findExistingLinedef(maps.linedefs, path1[i], path1[i + 1]);
    if (!found) continue;
    const ld = maps.linedefs.get(found.ldId);
    if (!ld) continue;
    for (const sdId of [ld.frontSide, ld.backSide]) {
      if (!sdId) continue;
      const sd = maps.sidedefs.get(sdId);
      if (sd && sd.sector === sectorId) {
        record(`map/sidedefs/${sdId}`, { ...sd }, { ...sd, sector: newSid });
        mapRef('sidedefs').child(sdId).update({ sector: newSid });
      }
    }
  }

  // 4. Create chain linedefs (two-sided)
  // Determine which sector is on the right (front) side of the chain direction.
  // path2 stays with sectorId; check if it's on the right of start→end.
  const sv = maps.vertices.get(startVid)!;
  const ev = maps.vertices.get(endVid)!;
  const testVid = path2[Math.floor(path2.length / 2)];
  const tv = maps.vertices.get(testVid)!;
  const cross = (ev.x - sv.x) * (tv.y - sv.y) - (ev.y - sv.y) * (tv.x - sv.x);
  // In y-up: cross < 0 → right (front) side, cross > 0 → left (back) side
  const originalOnFront = cross < 0;
  const frontSector = originalOnFront ? sectorId : newSid;
  const backSector = originalOnFront ? newSid : sectorId;

  for (let i = 0; i < chainVids.length - 1; i++) {
    const va = chainVids[i], vb = chainVids[i + 1];

    // Skip if linedef already exists between these vertices
    if (findExistingLinedef(maps.linedefs, va, vb)) continue;

    const ldVal: any = { v1: va, v2: vb, flags: 4 };
    const ldRef = mapRef('linedefs').push(ldVal);
    record(`map/linedefs/${ldRef.key}`, null, ldVal);

    const frontSdVal = {
      sector: frontSector, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: '-', lower: 'STARTAN2',
    };
    const frontSdRef = await mapRef('sidedefs').push(frontSdVal);
    record(`map/sidedefs/${frontSdRef.key}`, null, frontSdVal);

    const backSdVal = {
      sector: backSector, xoff: 0, yoff: 0,
      upper: 'STARTAN2', mid: '-', lower: 'STARTAN2',
    };
    const backSdRef = await mapRef('sidedefs').push(backSdVal);
    record(`map/sidedefs/${backSdRef.key}`, null, backSdVal);

    const ldUpdates = { frontSide: frontSdRef.key, backSide: backSdRef.key };
    record(`map/linedefs/${ldRef.key}`, ldVal, { ...ldVal, ...ldUpdates });
    await mapRef('linedefs').child(ldRef.key).update(ldUpdates);
  }

  // 5. Reassign holes to correct sector
  const newSecPoly: Point[] = [];
  for (const vid of path1) {
    const v = maps.vertices.get(vid);
    if (v) newSecPoly.push(v);
  }
  for (let i = chainVids.length - 2; i >= 1; i--) {
    const v = maps.vertices.get(chainVids[i]);
    if (v) newSecPoly.push(v);
  }

  for (const holeLoop of loops) {
    if (holeLoop === targetLoop) continue;
    let cx = 0, cy = 0, cnt = 0;
    for (const vid of holeLoop) {
      const v = maps.vertices.get(vid);
      if (v) { cx += v.x; cy += v.y; cnt++; }
    }
    if (!cnt) continue;
    cx /= cnt; cy /= cnt;

    if (pointInPoly(cx, cy, newSecPoly)) {
      for (let i = 0; i < holeLoop.length; i++) {
        const found = findExistingLinedef(maps.linedefs, holeLoop[i], holeLoop[(i + 1) % holeLoop.length]);
        if (!found) continue;
        const ld = maps.linedefs.get(found.ldId);
        if (!ld) continue;
        for (const sdId of [ld.frontSide, ld.backSide]) {
          if (!sdId) continue;
          const sd = maps.sidedefs.get(sdId);
          if (sd && sd.sector === sectorId) {
            record(`map/sidedefs/${sdId}`, { ...sd }, { ...sd, sector: newSid });
            mapRef('sidedefs').child(sdId).update({ sector: newSid });
          }
        }
      }
    }
  }

  setSelected({ type: 'sector', id: newSid });
  triggerRenderPanel();
  endAction();
  recordSectorDone();
  return [sectorId, newSid];
}

// ── Bridge two linedefs into a 4-sided sector ──

export async function bridgeLinedefs(lid1: string, lid2: string): Promise<void> {
  const ld1 = maps.linedefs.get(lid1);
  const ld2 = maps.linedefs.get(lid2);
  if (!ld1 || !ld2) return;

  // Reject if they share a vertex
  if (ld1.v1 === ld2.v1 || ld1.v1 === ld2.v2 || ld1.v2 === ld2.v1 || ld1.v2 === ld2.v2) {
    showToast('Linedefs share a vertex');
    return;
  }

  // Collect sectors each linedef belongs to
  const sectorsOf = (ld: Linedef): Set<string> => {
    const s = new Set<string>();
    const fs = ld.frontSide ? maps.sidedefs.get(ld.frontSide) : null;
    const bs = ld.backSide ? maps.sidedefs.get(ld.backSide) : null;
    if (fs?.sector) s.add(fs.sector);
    if (bs?.sector) s.add(bs.sector);
    return s;
  };
  const s1 = sectorsOf(ld1);
  const s2 = sectorsOf(ld2);
  for (const s of s1) {
    if (s2.has(s)) {
      showToast('Linedefs already share a sector');
      return;
    }
  }

  const va = maps.vertices.get(ld1.v1)!;
  const vb = maps.vertices.get(ld1.v2)!;
  const vc = maps.vertices.get(ld2.v1)!;
  const vd = maps.vertices.get(ld2.v2)!;
  if (!va || !vb || !vc || !vd) return;

  // Validate that new connecting edges don't cross any existing linedef
  function edgesValid(pairs: [Point, Point][]): boolean {
    for (const [p1, p2] of pairs) {
      for (const [, ld] of maps.linedefs) {
        const u = maps.vertices.get(ld.v1);
        const w = maps.vertices.get(ld.v2);
        if (!u || !w) continue;
        if (segmentsProperlyIntersect(p1.x, p1.y, p2.x, p2.y, u.x, u.y, w.x, w.y)) return false;
      }
    }
    // Check the two new edges don't cross each other
    if (pairs.length === 2) {
      const [p1, p2] = pairs[0], [p3, p4] = pairs[1];
      if (segmentsProperlyIntersect(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y)) return false;
    }
    return true;
  }

  // Option A: quad a→b→d→c  (new edges: b→d, c→a)
  // Option B: quad a→b→c→d  (new edges: b→c, d→a)
  const validA = edgesValid([[vb, vd], [vc, va]]);
  const validB = edgesValid([[vb, vc], [vd, va]]);

  let chain: DrawVertex[];
  if (validA && validB) {
    // Pick the one with smaller area
    const areaA = polyArea([va, vb, vd, vc]);
    const areaB = polyArea([va, vb, vc, vd]);
    chain = areaA <= areaB
      ? [{ x: va.x, y: va.y, existingId: ld1.v1 }, { x: vb.x, y: vb.y, existingId: ld1.v2 },
         { x: vd.x, y: vd.y, existingId: ld2.v2 }, { x: vc.x, y: vc.y, existingId: ld2.v1 }]
      : [{ x: va.x, y: va.y, existingId: ld1.v1 }, { x: vb.x, y: vb.y, existingId: ld1.v2 },
         { x: vc.x, y: vc.y, existingId: ld2.v1 }, { x: vd.x, y: vd.y, existingId: ld2.v2 }];
  } else if (validA) {
    chain = [{ x: va.x, y: va.y, existingId: ld1.v1 }, { x: vb.x, y: vb.y, existingId: ld1.v2 },
             { x: vd.x, y: vd.y, existingId: ld2.v2 }, { x: vc.x, y: vc.y, existingId: ld2.v1 }];
  } else if (validB) {
    chain = [{ x: va.x, y: va.y, existingId: ld1.v1 }, { x: vb.x, y: vb.y, existingId: ld1.v2 },
             { x: vc.x, y: vc.y, existingId: ld2.v1 }, { x: vd.x, y: vd.y, existingId: ld2.v2 }];
  } else {
    showToast('Connecting edges would intersect existing geometry');
    return;
  }

  recordBridgeLinedefs(lid1, lid2);
  await createSectorFromPolygon(chain, true);
}
