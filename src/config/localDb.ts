// In-memory database implementing the Firebase compat SDK interface.
// Used when Firebase env vars are missing or user hasn't connected.

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

const STORAGE_KEY = 'cowad-local-db';

// Global data store — nested object tree, hydrated from localStorage
const store: Record<string, any> = {};

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(store, JSON.parse(raw));
  } catch { /* ignore corrupt data */ }
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

loadFromStorage();

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
    // Root write — merge keys
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
  // Determine the parent path and child key for child_* events
  if (segments.length >= 2) {
    const parentPath = segments.slice(0, -1).join('/');
    const childKey = segments[segments.length - 1];
    const wasExisting = oldVal !== undefined;
    const isRemoved = newVal == null;

    if (!wasExisting && !isRemoved) {
      // child_added
      for (const cb of getListeners(parentPath, 'child_added')) {
        cb(new LocalSnapshot(childKey, newVal));
      }
    } else if (wasExisting && isRemoved) {
      // child_removed
      for (const cb of getListeners(parentPath, 'child_removed')) {
        cb(new LocalSnapshot(childKey, oldVal));
      }
    } else if (wasExisting && !isRemoved) {
      // child_changed
      for (const cb of getListeners(parentPath, 'child_changed')) {
        cb(new LocalSnapshot(childKey, newVal));
      }
    }
  }

  // Fire 'value' listeners on the exact path
  for (const cb of getListeners(fullPath, 'value')) {
    cb(new LocalSnapshot(segments[segments.length - 1] || '', newVal ?? null));
  }

  // Fire 'value' listeners on parent (for things like presence)
  if (segments.length >= 2) {
    const parentPath = segments.slice(0, -1).join('/');
    const parentVal = readPath(segments.slice(0, -1));
    for (const cb of getListeners(parentPath, 'value')) {
      cb(new LocalSnapshot(segments[segments.length - 2] || '', parentVal ?? null));
    }
  }
}

// Start counter high enough to avoid collisions with keys persisted from prior sessions
let pushCounter = Date.now();

class LocalRef implements FirebaseRef {
  private _path: string;

  constructor(path: string) {
    // Normalize: strip leading/trailing slashes
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
    return { remove() {} }; // no-op locally
  }
}

class LocalDatabase implements FirebaseDatabase {
  ref(path?: string): FirebaseRef {
    return new LocalRef(path || '');
  }
}

export function createLocalDb(): FirebaseDatabase {
  return new LocalDatabase();
}
