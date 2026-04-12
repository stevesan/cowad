import type { Vertex, Linedef, Sidedef, Sector } from '../types';
import { maps } from '../state/appState';
import { mapRef } from '../config/firebase';
import { record } from '../history/undoRedo';

export interface MapContext {
  vertices:  Map<string, Vertex>;
  linedefs:  Map<string, Linedef>;
  sidedefs:  Map<string, Sidedef>;
  sectors:   Map<string, Sector>;

  pushVertex(val: Vertex): string;
  pushLinedef(val: Linedef): string;
  pushSidedef(val: Sidedef): string;
  pushSector(val: Sector): string;

  updateLinedef(id: string, updates: Partial<Linedef>): void;
  updateSidedef(id: string, updates: Partial<Sidedef>): void;
}

export function createLiveContext(): MapContext {
  return {
    vertices: maps.vertices,
    linedefs: maps.linedefs,
    sidedefs: maps.sidedefs,
    sectors: maps.sectors,

    pushVertex(val) {
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      if (!maps.vertices.has(ref.key!)) maps.vertices.set(ref.key!, val);
      return ref.key!;
    },
    pushLinedef(val) {
      const ref = mapRef('linedefs').push(val);
      record(`map/linedefs/${ref.key}`, null, val);
      if (!maps.linedefs.has(ref.key!)) maps.linedefs.set(ref.key!, val as Linedef);
      return ref.key!;
    },
    pushSidedef(val) {
      const ref = mapRef('sidedefs').push(val);
      record(`map/sidedefs/${ref.key}`, null, val);
      if (!maps.sidedefs.has(ref.key!)) maps.sidedefs.set(ref.key!, val);
      return ref.key!;
    },
    pushSector(val) {
      const ref = mapRef('sectors').push(val);
      record(`map/sectors/${ref.key}`, null, val);
      return ref.key!;
    },

    updateLinedef(id, updates) {
      const ld = maps.linedefs.get(id);
      if (ld) {
        record(`map/linedefs/${id}`, { ...ld }, { ...ld, ...updates });
        Object.assign(ld, updates);
      }
      mapRef('linedefs').child(id).update(updates);
    },
    updateSidedef(id, updates) {
      const sd = maps.sidedefs.get(id);
      if (sd) {
        record(`map/sidedefs/${id}`, { ...sd }, { ...sd, ...updates });
        Object.assign(sd, updates);
      }
      mapRef('sidedefs').child(id).update(updates);
    },
  };
}

let _cloneCounter = 0;

export function createCloneContext(): MapContext {
  const vertices = new Map<string, Vertex>();
  maps.vertices.forEach((v, k) => vertices.set(k, { ...v }));
  const linedefs = new Map<string, Linedef>();
  maps.linedefs.forEach((ld, k) => linedefs.set(k, { ...ld }));
  const sidedefs = new Map<string, Sidedef>();
  maps.sidedefs.forEach((sd, k) => sidedefs.set(k, { ...sd }));
  const sectors = new Map<string, Sector>();
  maps.sectors.forEach((s, k) => sectors.set(k, { ...s }));

  function genId(): string {
    return `_hs_${++_cloneCounter}`;
  }

  return {
    vertices,
    linedefs,
    sidedefs,
    sectors,

    pushVertex(val) {
      const id = genId();
      vertices.set(id, val);
      return id;
    },
    pushLinedef(val) {
      const id = genId();
      linedefs.set(id, val as Linedef);
      return id;
    },
    pushSidedef(val) {
      const id = genId();
      sidedefs.set(id, val);
      return id;
    },
    pushSector(val) {
      const id = genId();
      sectors.set(id, val);
      return id;
    },

    updateLinedef(id, updates) {
      const ld = linedefs.get(id);
      if (ld) Object.assign(ld, updates);
    },
    updateSidedef(id, updates) {
      const sd = sidedefs.get(id);
      if (sd) Object.assign(sd, updates);
    },
  };
}
