// In-memory database implementing the Firebase compat SDK interface.
// Uses IndexedDB for persistence (localStorage is too small for IWAD textures).

type Listener = (snapshot: FirebaseSnapshot) => void;

interface ListenerEntry {
  event: string;
  callback: Listener;
}

class LocalSnapshot implements FirebaseSnapshot {
  key: string;
  private _val: any;
  constructor(key: string, val: any) {
    this.key = key;
    this._val = val;
  }
  val(): any { return this._val; }
  numChildren(): number {
    if (this._val && typeof this._val === 'object') return Object.keys(this._val).length;
    return 0;
  }
}

const IDB_NAME = 'cowad-local';
const IDB_STORE = 'data';
const IDB_KEY = 'store';

// Global data store — nested object tree, hydrated from IndexedDB
const store: Record<string, any> = {};

let idb: IDBDatabase | null = null;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function loadFromIdb(): Promise<void> {
  return openIdb().then(database => {
    idb = database;
    return new Promise<void>(resolve => {
      const tx = database.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        if (req.result) Object.assign(store, req.result);
        resolve();
      };
      req.onerror = () => resolve(); // start even if load fails
    });
  }).catch(() => {}); // IndexedDB unavailable — run in-memory only
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  if (!idb) return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!idb) return;
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(structuredClone(store), IDB_KEY);
  }, 100);
}

// Listeners keyed by path, then event type
const listeners = new Map<string, ListenerEntry[]>();

function getListeners(path: string, event: string): Listener[] {
  const entries = listeners.get(path);
  if (!entries) return [];
  return entries.filter(e => e.event === event).map(e => e.callback);
}

function addListener(path: string, event: string, callback: Listener): void {
  if (!listeners.has(path)) listeners.set(path, []);
  listeners.get(path)!.push({ event, callback });
}

/** Read a value from the nested store by path segments */
function readPath(segments: string[]): any {
  let cur: any = store;
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Write a value into the nested store by path segments, creating intermediates */
function writePath(segments: string[], value: any): void {
  if (segments.length === 0) {
    if (value == null) {
      for (const k of Object.keys(store)) delete store[k];
    } else if (typeof value === 'object') {
      Object.assign(store, value);
    }
    return;
  }
  let cur: any = store;
  for (let i = 0; i < segments.length - 1; i++) {
    if (cur[segments[i]] == null || typeof cur[segments[i]] !== 'object') {
      cur[segments[i]] = {};
    }
    cur = cur[segments[i]];
  }
  const lastKey = segments[segments.length - 1];
  if (value == null) {
    delete cur[lastKey];
  } else {
    cur[lastKey] = value;
  }
}

/** Fire child_added/changed/removed and value listeners after a path write */
function fireListeners(fullPath: string, segments: string[], oldVal: any, newVal: any): void {
  if (segments.length >= 2) {
    const parentPath = segments.slice(0, -1).join('/');
    const childKey = segments[segments.length - 1];
    const wasExisting = oldVal !== undefined;
    const isRemoved = newVal == null;

    if (!wasExisting && !isRemoved) {
      for (const cb of getListeners(parentPath, 'child_added')) {
        cb(new LocalSnapshot(childKey, newVal));
      }
    } else if (wasExisting && isRemoved) {
      for (const cb of getListeners(parentPath, 'child_removed')) {
        cb(new LocalSnapshot(childKey, oldVal));
      }
    } else if (wasExisting && !isRemoved) {
      for (const cb of getListeners(parentPath, 'child_changed')) {
        cb(new LocalSnapshot(childKey, newVal));
      }
    }
  }

  // Fire 'value' listeners on the exact path
  for (const cb of getListeners(fullPath, 'value')) {
    cb(new LocalSnapshot(segments[segments.length - 1] || '', newVal ?? null));
  }

  // Fire 'value' listeners on parent
  if (segments.length >= 2) {
    const parentPath = segments.slice(0, -1).join('/');
    const parentVal = readPath(segments.slice(0, -1));
    for (const cb of getListeners(parentPath, 'value')) {
      cb(new LocalSnapshot(segments[segments.length - 2] || '', parentVal ?? null));
    }
  }

  // When a subtree is removed, cascade child_removed to all descendant listeners
  // (mirrors real Firebase behavior where removing a parent fires child_removed on
  // listeners registered on child paths)
  if (newVal == null && oldVal && typeof oldVal === 'object') {
    for (const [listenerPath, entries] of listeners) {
      if (!listenerPath.startsWith(fullPath + '/')) continue;
      const relSegs = listenerPath.slice(fullPath.length + 1).split('/');
      let node: any = oldVal;
      for (const seg of relSegs) {
        if (node == null || typeof node !== 'object') { node = undefined; break; }
        node = node[seg];
      }
      if (node == null || typeof node !== 'object') continue;
      const removedCbs = entries.filter(e => e.event === 'child_removed').map(e => e.callback);
      for (const cb of removedCbs) {
        for (const [k, v] of Object.entries(node)) {
          cb(new LocalSnapshot(k, v));
        }
      }
    }
  }

  // When an object is replaced with another object, fire child-level events on
  // fullPath itself (mirrors real Firebase behavior for collection-level writes)
  const oldIsObj = oldVal != null && typeof oldVal === 'object';
  const newIsObj = newVal != null && typeof newVal === 'object';
  if (newIsObj) {
    const oldKeys = oldIsObj ? new Set(Object.keys(oldVal)) : new Set<string>();
    for (const [k, v] of Object.entries(newVal)) {
      if (!oldKeys.has(k)) {
        for (const cb of getListeners(fullPath, 'child_added')) cb(new LocalSnapshot(k, v));
      } else if (JSON.stringify(oldVal[k]) !== JSON.stringify(v)) {
        for (const cb of getListeners(fullPath, 'child_changed')) cb(new LocalSnapshot(k, v));
      }
    }
    if (oldIsObj) {
      for (const k of Object.keys(oldVal)) {
        if (!(k in newVal)) {
          for (const cb of getListeners(fullPath, 'child_removed')) cb(new LocalSnapshot(k, oldVal[k]));
        }
      }
    }
  }
}

// Start counter high enough to avoid collisions with keys persisted from prior sessions
let pushCounter = Date.now();

class LocalRef implements FirebaseRef {
  private _path: string;

  constructor(path: string) {
    this._path = path.replace(/^\/+|\/+$/g, '');
  }

  get key(): string {
    const parts = this._path.split('/');
    return parts[parts.length - 1] || '';
  }

  private get segments(): string[] {
    return this._path ? this._path.split('/') : [];
  }

  child(path: string): FirebaseRef {
    const joined = this._path ? `${this._path}/${path}` : path;
    return new LocalRef(joined);
  }

  set(value: any): Promise<void> {
    const segs = this.segments;
    const oldVal = readPath(segs);
    writePath(segs, value);
    const newVal = readPath(segs);
    fireListeners(this._path, segs, oldVal, newVal);
    persist();
    return Promise.resolve();
  }

  update(value: any): Promise<void> {
    if (value == null) return Promise.resolve();
    const segs = this.segments;

    if (segs.length === 0) {
      // Root-level update: each key is a deep path (used by undo/redo)
      for (const [relPath, val] of Object.entries(value)) {
        const pathSegs = relPath.split('/').filter(s => s);
        const oldVal = readPath(pathSegs);
        writePath(pathSegs, val);
        const newVal = readPath(pathSegs);
        fireListeners(relPath, pathSegs, oldVal, newVal);
      }
    } else {
      // Non-root: merge properties into existing object, fire as one change
      const oldVal = readPath(segs);
      const merged = (oldVal && typeof oldVal === 'object') ? { ...oldVal } : {};
      for (const [k, v] of Object.entries(value)) {
        if (v == null) delete merged[k];
        else merged[k] = v;
      }
      writePath(segs, merged);
      fireListeners(this._path, segs, oldVal, merged);
    }

    persist();
    return Promise.resolve();
  }

  remove(): Promise<void> {
    return this.set(null);
  }

  push(value?: any): Promise<FirebaseRef> & { key: string } {
    const key = '-' + (++pushCounter).toString(36) + Math.random().toString(36).slice(2, 8);
    const childRef = this.child(key) as LocalRef;
    if (value !== undefined) {
      const p = childRef.set(value).then(() => childRef) as any;
      p.key = key;
      return p;
    }
    const p = Promise.resolve(childRef) as any;
    p.key = key;
    return p;
  }

  on(event: string, callback: (snapshot: FirebaseSnapshot) => void): void {
    addListener(this._path, event, callback);

    // Fire immediately for existing data
    if (event === 'value') {
      const val = readPath(this.segments);
      callback(new LocalSnapshot(this.key, val ?? null));
    } else if (event === 'child_added') {
      const val = readPath(this.segments);
      if (val && typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          callback(new LocalSnapshot(k, v));
        }
      }
    }
  }

  once(event: string): Promise<FirebaseSnapshot> {
    const val = readPath(this.segments);
    return Promise.resolve(new LocalSnapshot(this.key, val ?? null));
  }

  onDisconnect(): { remove(): void } {
    return { remove() {} };
  }
}

class LocalDatabase implements FirebaseDatabase {
  ref(path?: string): FirebaseRef {
    return new LocalRef(path || '');
  }
}

/** Clear all data and listeners (for testing). */
export function resetLocalDb(): void {
  for (const k of Object.keys(store)) delete store[k];
  listeners.clear();
  pushCounter = 0;
}

/** Creates a local DB and returns it along with a ready promise that resolves once IndexedDB data is loaded. */
export function createLocalDb(): { db: FirebaseDatabase; ready: Promise<void> } {
  const ready = loadFromIdb();
  return { db: new LocalDatabase(), ready };
}
