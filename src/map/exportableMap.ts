import { mapRef } from '../config/firebase';
import { maps } from '../state/appState';
import { record } from '../history/undoRedo';
import type { Vertex, Linedef, Sidedef, Sector } from '../types';

export interface ExportableMap {
  vertices: Map<string, Vertex>;
  linedefs: Map<string, Linedef>;
  sidedefs: Map<string, Sidedef>;
  sectors:  Map<string, Sector>;

  pushVertex(val: Vertex): string;
  pushLinedef(val: Linedef): string;
  pushSidedef(val: Sidedef): string;
  pushSector(val: Sector): string;

  updateLinedef(id: string, updates: Partial<Linedef>): void;
  updateSidedef(id: string, updates: Partial<Sidedef>): void;
}

export function createLiveContext(): ExportableMap {
  return {
    vertices: maps.vertices,
    linedefs: maps.linedefs,
    sidedefs: maps.sidedefs,
    sectors:  maps.sectors,

    pushVertex(val: Vertex): string {
      const ref = mapRef('vertices').push(val);
      record(`map/vertices/${ref.key}`, null, val);
      if (!maps.vertices.has(ref.key)) maps.vertices.set(ref.key, val as any);
      return ref.key;
    },

    pushLinedef(val: Linedef): string {
      const ref = mapRef('linedefs').push(val);
      record(`map/linedefs/${ref.key}`, null, val);
      if (!maps.linedefs.has(ref.key)) maps.linedefs.set(ref.key, val as any);
      return ref.key;
    },

    pushSidedef(val: Sidedef): string {
      const ref = mapRef('sidedefs').push(val);
      record(`map/sidedefs/${ref.key}`, null, val);
      return ref.key;
    },

    pushSector(val: Sector): string {
      const ref = mapRef('sectors').push(val);
      record(`map/sectors/${ref.key}`, null, val);
      return ref.key;
    },

    updateLinedef(id: string, updates: Partial<Linedef>): void {
      const ld = maps.linedefs.get(id)!;
      const before = { ...ld };
      record(`map/linedefs/${id}`, before, { ...before, ...updates });
      mapRef('linedefs').child(id).update(updates);
    },

    updateSidedef(id: string, updates: Partial<Sidedef>): void {
      const sd = maps.sidedefs.get(id)!;
      const before = { ...sd };
      record(`map/sidedefs/${id}`, before, { ...before, ...updates });
      mapRef('sidedefs').child(id).update(updates);
    },
  };
}

export function createCloneContext(): ExportableMap {
  let counter = 0;
  const nextId = () => `_clone_${counter++}`;

  const vertices = new Map<string, Vertex>();
  const linedefs = new Map<string, Linedef>();
  const sidedefs = new Map<string, Sidedef>();
  const sectors  = new Map<string, Sector>();

  for (const [k, v] of maps.vertices) vertices.set(k, { ...v });
  for (const [k, v] of maps.linedefs) linedefs.set(k, { ...v });
  for (const [k, v] of maps.sidedefs) sidedefs.set(k, { ...v });
  for (const [k, v] of maps.sectors)  sectors.set(k, { ...v });

  return {
    vertices,
    linedefs,
    sidedefs,
    sectors,

    pushVertex(val: Vertex): string {
      const id = nextId();
      vertices.set(id, val);
      return id;
    },

    pushLinedef(val: Linedef): string {
      const id = nextId();
      linedefs.set(id, val);
      return id;
    },

    pushSidedef(val: Sidedef): string {
      const id = nextId();
      sidedefs.set(id, val);
      return id;
    },

    pushSector(val: Sector): string {
      const id = nextId();
      sectors.set(id, val);
      return id;
    },

    updateLinedef(id: string, updates: Partial<Linedef>): void {
      const ld = linedefs.get(id);
      if (ld) Object.assign(ld, updates);
    },

    updateSidedef(id: string, updates: Partial<Sidedef>): void {
      const sd = sidedefs.get(id);
      if (sd) Object.assign(sd, updates);
    },
  };
}
