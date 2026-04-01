import { mapRef } from '../config/firebase';
import { maps, selected, setSelected, multiSelected, multiSelectType, setMultiSelected, mouseWorld, triggerRenderPanel, triggerDraw } from '../state/appState';
import { findExistingLinedef, mergeWouldDuplicate } from '../geometry/sectorQueries';
import { segmentsProperlyIntersect } from '../geometry/hitTest';
import { beginAction, record, endAction } from '../history/undoRedo';
import { showToast } from '../ui/toast';
import { getSelectedThingType } from '../ui/thingBrowser';
import { applyExternalDrawChain } from './drawSession';
import { recordDeleteBefore, recordDeleteDone, recordMergeVertices, recordMergeSectors, recordPlaceThing, recordSplitLinedef, recordDeleteMultiSelected } from '../testing/recorder';

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

// ── Bridge two linedefs into a 4-sided sector ──

export async function bridgeLinedefs(lid1: string, lid2: string): Promise<void> {
  const ld1 = maps.linedefs.get(lid1);
  const ld2 = maps.linedefs.get(lid2);
  if (!ld1 || !ld2) return;
  if (lid1 === lid2) { showToast('Select two different linedefs'); return; }

  const vids1 = [ld1.v1, ld1.v2];
  const vids2 = [ld2.v1, ld2.v2];
  if (new Set([...vids1, ...vids2]).size !== 4) {
    showToast('Cannot bridge: linedefs share a vertex');
    return;
  }

  const [a, b] = vids1.map(id => maps.vertices.get(id)!);
  const [c, d] = vids2.map(id => maps.vertices.get(id)!);
  if (!a || !b || !c || !d) return;

  // Check if a new edge crosses any existing linedef
  function edgeCrossesExisting(p1x: number, p1y: number, p2x: number, p2y: number): boolean {
    for (const [, ld] of maps.linedefs) {
      const v1 = maps.vertices.get(ld.v1), v2 = maps.vertices.get(ld.v2);
      if (!v1 || !v2) continue;
      if (segmentsProperlyIntersect(p1x, p1y, p2x, p2y, v1.x, v1.y, v2.x, v2.y)) return true;
    }
    return false;
  }

  // Two possible quadrilateral orderings:
  // 1: A-B-C-D → new edges B→C and D→A
  // 2: A-B-D-C → new edges B→D and C→A
  const order1ok = !segmentsProperlyIntersect(b.x, b.y, c.x, c.y, d.x, d.y, a.x, a.y)
    && !edgeCrossesExisting(b.x, b.y, c.x, c.y) && !edgeCrossesExisting(d.x, d.y, a.x, a.y);
  const order2ok = !segmentsProperlyIntersect(b.x, b.y, d.x, d.y, c.x, c.y, a.x, a.y)
    && !edgeCrossesExisting(b.x, b.y, d.x, d.y) && !edgeCrossesExisting(c.x, c.y, a.x, a.y);

  let order: string[];
  if (order1ok) {
    order = [ld1.v1, ld1.v2, ld2.v1, ld2.v2];
  } else if (order2ok) {
    order = [ld1.v1, ld1.v2, ld2.v2, ld2.v1];
  } else {
    showToast('Cannot bridge: connecting edges would intersect');
    return;
  }

  const chain = order.map(vid => {
    const v = maps.vertices.get(vid)!;
    return { x: v.x, y: v.y, existingId: vid };
  });

  await applyExternalDrawChain(chain, true);
}
