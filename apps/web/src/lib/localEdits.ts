/**
 * "This user just edited board X" — raised by the room session for every local op it accepts
 * (draw, move, delete, undo…), not for remote ops. Board thumbnails (Phase 11) hang off it.
 */
type Listener = (boardId: string) => void;
const listeners = new Set<Listener>();

export function onLocalEdit(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitLocalEdit(boardId: string): void {
  for (const fn of listeners) fn(boardId);
}
