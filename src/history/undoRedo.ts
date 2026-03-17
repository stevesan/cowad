import { db } from '../config/firebase';
import { showToast } from '../ui/toast';

interface Change {
  path: string;   // full Firebase path, e.g. "map/vertices/-abc123"
  before: any;    // null if entity was created
  after: any;     // null if entity was removed
}

interface Action {
  changes: Change[];
}

const undoStack: Action[] = [];
const redoStack: Action[] = [];
let pending: Change[] | null = null;
let actionDepth = 0;
let _undoRedoing = false;
let _applying = false;

const MAX_HISTORY = 50;

export function beginAction(): void {
  if (_undoRedoing) return;
  if (actionDepth === 0) pending = [];
  actionDepth++;
}

export function record(path: string, before: any, after: any): void {
  if (_undoRedoing || !pending) return;
  pending.push({ path, before, after });
}

export function endAction(): void {
  if (_undoRedoing) return;
  if (actionDepth <= 0) return;
  actionDepth--;
  if (actionDepth === 0) {
    if (pending && pending.length > 0) {
      undoStack.push({ changes: pending });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
    }
    pending = null;
  }
}

export function isUndoRedoing(): boolean {
  return _undoRedoing;
}

export async function undo(): Promise<void> {
  if (_applying) return;
  const action = undoStack.pop();
  if (!action) { showToast('Nothing to undo'); return; }

  _applying = true;
  _undoRedoing = true;
  try {
    const updates: Record<string, any> = {};
    for (const { path, before } of action.changes) {
      updates[path] = before;
    }
    await db.ref().update(updates);
    redoStack.push(action);
  } finally {
    _undoRedoing = false;
    _applying = false;
  }
}

export async function redo(): Promise<void> {
  if (_applying) return;
  const action = redoStack.pop();
  if (!action) { showToast('Nothing to redo'); return; }

  _applying = true;
  _undoRedoing = true;
  try {
    const updates: Record<string, any> = {};
    for (const { path, after } of action.changes) {
      updates[path] = after;
    }
    await db.ref().update(updates);
    undoStack.push(action);
  } finally {
    _undoRedoing = false;
    _applying = false;
  }
}
