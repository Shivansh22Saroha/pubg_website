/**
 * Element edits as user actions (FEATURES F6): every action — a create, a batch move, an
 * erase sweep, a style change — goes out as one bulk send and becomes one undo step. Undo and
 * redo (ARCHITECTURE §7.5) are sent as ordinary ops with new opIds.
 */
import type { ElementInput } from '@rotationlab/shared';
import { toast } from 'sonner';
import { planHistory, type Change, type LocalOp, type ViewElement } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';

/** What actions are sent through (RoomSession). */
export interface EditSink {
  sendMany(ops: LocalOp[]): string[] | null;
}

/** FEATURES F6 bulk-op rule: an offline action that doesn't fit the queue is refused whole. */
export const OFFLINE_REFUSED = 'Too many changes while offline — reconnect first';

export type EditResult = 'ok' | 'empty' | 'refused';

/** A view element as an `ElementInput` (drops the server-owned fields). */
export function toInput(el: ViewElement): ElementInput {
  const {
    seq: _seq,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    updatedAt: _updatedAt,
    pending: _pending,
    ...input
  } = el;
  return input as ElementInput;
}

function same(a: ElementInput | null, b: ElementInput | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

function opFor(id: string, state: ElementInput | null): LocalOp {
  return state
    ? { kind: 'element:upsert', element: state }
    : { kind: 'element:delete', elementId: id };
}

/**
 * Sends the changes as one action and records it. `action` writes `after` and starts a new
 * undo step (clearing redo); `undo` writes `before`, `redo` writes `after`.
 */
export function applyChanges(
  sink: EditSink,
  changes: Change[],
  kind: 'action' | 'undo' | 'redo' = 'action',
): EditResult {
  const { boardId } = useBoardStore.getState();
  const list = kind === 'action' ? changes.filter((c) => !same(c.before, c.after)) : changes;
  if (!boardId || list.length === 0) return 'empty';
  const opIds = sink.sendMany(list.map((c) => opFor(c.id, kind === 'undo' ? c.before : c.after)));
  if (!opIds) return 'refused';
  const ids: Record<string, string> = {};
  list.forEach((c, i) => {
    const opId = opIds[i];
    if (opId) ids[c.id] = opId;
  });
  useBoardStore.getState().pushHistory(boardId, { changes: list, opIds: ids }, kind);
  return 'ok';
}

export interface HistoryFeedback {
  /** display name for a user id (null = unknown) */
  nameOf: (userId: string | null) => string;
  notify: (message: string) => void;
}

/**
 * Undo or redo the latest step on the active board. Elements someone else changed since are
 * skipped with "Changed by {name}"; the rest still applies. Returns false when there was
 * nothing to undo / redo.
 */
export function stepHistory(sink: EditSink, dir: 'undo' | 'redo', fb: HistoryFeedback): boolean {
  const store = useBoardStore.getState();
  const { boardId } = store;
  if (!boardId) return false;
  const step = store.popHistory(boardId, dir);
  if (!step) return false;
  const plan = planHistory(useBoardStore.getState(), step, dir);
  if (plan.skipped.length > 0) {
    const names = [...new Set(plan.skipped.map((s) => fb.nameOf(s.by)))];
    fb.notify(`Changed by ${names.join(', ')}`);
  }
  if (plan.apply.length === 0) return true;
  if (applyChanges(sink, plan.apply, dir) === 'refused') {
    // put it back where it was, untouched
    useBoardStore.getState().pushHistory(boardId, step, dir === 'undo' ? 'redo' : 'undo');
    fb.notify(OFFLINE_REFUSED);
  }
  return true;
}

/** Element actions that don't need the map: also used by the toolbar and the style bar. */
export function editorActions(session: EditSink | null, nameOf: (id: string | null) => string) {
  const feedback = {
    nameOf,
    notify: (message: string) => {
      toast(message, { id: `history-${message}` });
    },
  };
  return {
    commit(changes: Change[]): boolean {
      if (!session) return false;
      const res = applyChanges(session, changes);
      if (res === 'refused') toast.error(OFFLINE_REFUSED, { id: 'offline-refused' });
      return res === 'ok';
    },
    undo() {
      if (session) stepHistory(session, 'undo', feedback);
    },
    redo() {
      if (session) stepHistory(session, 'redo', feedback);
    },
  };
}

/** "Changed by {name}": member display names, "you" for this user. */
export function makeNameOf(meId: string, names: Readonly<Record<string, string>>) {
  return (id: string | null) =>
    id === null ? 'someone' : id === meId ? 'you' : (names[id] ?? 'someone');
}
