import type { BoardOp, Element, ElementInput, Layer } from '@rotationlab/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyChanges, stepHistory, toInput, type EditSink } from '@/lib/editing';
import { MAX_HISTORY, MAX_PENDING, type LocalOp, type PendingOp } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';

/** Undo / redo (ARCHITECTURE §7.5, FEATURES F6) and the bulk-op rule, through the real store. */

const BOARD = '0192f7a1-0000-7000-8000-00000000000b';
const ME = '0192f7a1-0000-7000-8000-0000000000aa';
const BOB = '0192f7a1-0000-7000-8000-0000000000bb';
const L1 = '0192f7a1-0000-7000-8000-0000000000c1';
let n = 0;
const uid = () => `0192f7a1-0000-7000-8000-${String(++n).padStart(12, '0')}`;

const layer: Layer = {
  id: L1,
  boardId: BOARD,
  name: 'Plan',
  color: '#F2A900',
  position: 0,
  visible: true,
  locked: false,
  seq: 0,
};

const line = (id: string, x = 0): ElementInput => ({
  id,
  boardId: BOARD,
  layerId: L1,
  type: 'LINE',
  geometry: {
    points: [
      [x, 0],
      [x + 100, 100],
    ],
  },
  style: { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 },
  props: {},
  z: 0,
});

const stored = (el: ElementInput, seq: number, by = BOB): Element => ({
  ...el,
  geometry: el.geometry,
  props: el.props,
  seq,
  createdBy: by,
  updatedBy: by,
  updatedAt: '2026-10-26T10:00:00.000Z',
});

const store = () => useBoardStore.getState();
let seq = 10;
let online = true;

/** Behaves like RoomSession.sendMany over the real store; records every send. */
const sends: LocalOp[][] = [];
const sink: EditSink = {
  sendMany(ops) {
    const list = ops.map((op): PendingOp => ({ opId: uid(), boardId: BOARD, op }));
    if (!store().localMany(list, online)) return null;
    sends.push(ops);
    return list.map((p) => p.opId);
  },
};
/** the server acknowledges everything still pending, in order */
const ackAll = () => {
  for (const p of [...store().pending]) store().ack(p.opId, ++seq);
};
const remote = (op: BoardOp['op'], actorId = BOB) => {
  store().remote({ boardId: BOARD, seq: ++seq, actorId, opId: uid(), op });
};

const toasts: string[] = [];
const fb = {
  nameOf: (id: string | null) => (id === BOB ? 'Bob' : id === ME ? 'you' : 'someone'),
  notify: (m: string) => {
    toasts.push(m);
  },
};
const undo = () => stepHistory(sink, 'undo', fb);
const redo = () => stepHistory(sink, 'redo', fb);
const view = (id: string) => store().view.elements[id];
const xOf = (id: string) => (view(id)?.geometry as { points: [number, number][] }).points[0]?.[0];
const moved = (id: string, x: number) => {
  const el = view(id);
  if (!el) throw new Error(`no ${id}`);
  const before = toInput(el);
  return { id, before, after: line(id, x) };
};
const history = () => store().history[BOARD] ?? { undo: [], redo: [] };

beforeEach(() => {
  seq = 10;
  online = true;
  sends.length = 0;
  toasts.length = 0;
  store().reset();
  useBoardStore.setState({ history: {}, mySeq: {}, removedBy: {} });
  store().setMe(ME);
  store().switchBoard(BOARD);
  store().subscribed(BOARD, {
    mode: 'full',
    seq: 10,
    layers: [layer],
    elements: [stored(line('e1', 0), 5), stored(line('e2', 1000), 6), stored(line('e3', 2000), 7)],
  });
});

describe('undo / redo cases', () => {
  it('undo of a create deletes the element; redo re-creates it with the same id', () => {
    const el = line('new', 500);
    expect(applyChanges(sink, [{ id: 'new', before: null, after: el }])).toBe('ok');
    ackAll();
    expect(view('new')).toBeDefined();

    expect(undo()).toBe(true);
    expect(sends.at(-1)).toEqual([{ kind: 'element:delete', elementId: 'new' }]);
    ackAll();
    expect(view('new')).toBeUndefined();

    expect(redo()).toBe(true);
    expect(sends.at(-1)).toEqual([{ kind: 'element:upsert', element: el }]);
    ackAll();
    expect(view('new')?.id).toBe('new');
  });

  it('undo of a delete re-creates the element with the same id and content', () => {
    const before = toInput(view('e2')!);
    applyChanges(sink, [{ id: 'e2', before, after: null }]);
    ackAll();
    expect(view('e2')).toBeUndefined();
    undo();
    expect(sends.at(-1)).toEqual([{ kind: 'element:upsert', element: before }]);
    ackAll();
    expect(toInput(view('e2')!)).toEqual(before);
  });

  it('undo of an update restores the previous values', () => {
    applyChanges(sink, [moved('e1', 9000)]);
    ackAll();
    expect(xOf('e1')).toBe(9000);
    undo();
    ackAll();
    expect(xOf('e1')).toBe(0);
    redo();
    ackAll();
    expect(xOf('e1')).toBe(9000);
  });

  it('a batch move is one step: one send, and one undo restores every element', () => {
    applyChanges(sink, [moved('e1', 5), moved('e2', 1005), moved('e3', 2005)]);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toHaveLength(3);
    ackAll();
    expect(history().undo).toHaveLength(1);
    undo();
    expect(sends).toHaveLength(2);
    expect(sends[1]).toHaveLength(3);
    ackAll();
    expect([xOf('e1'), xOf('e2'), xOf('e3')]).toEqual([0, 1000, 2000]);
  });

  it('two own edits in a row undo one after the other (own later writes are not "remote")', () => {
    applyChanges(sink, [moved('e1', 100)]);
    ackAll();
    applyChanges(sink, [moved('e1', 200)]);
    ackAll();
    undo();
    ackAll();
    expect(xOf('e1')).toBe(100);
    undo();
    ackAll();
    expect(xOf('e1')).toBe(0);
    expect(toasts).toEqual([]);
  });

  it('undo works while the original op is still unacknowledged', () => {
    applyChanges(sink, [moved('e1', 300)]);
    undo();
    expect(xOf('e1')).toBe(0);
    ackAll();
    expect(xOf('e1')).toBe(0);
  });

  it('no-op changes (same before and after) record nothing', () => {
    const el = toInput(view('e1')!);
    expect(applyChanges(sink, [{ id: 'e1', before: el, after: el }])).toBe('empty');
    expect(history().undo).toHaveLength(0);
  });
});

describe('seq rule: changed by someone else', () => {
  it('skips the element Bob changed since (toast "Changed by Bob"); the rest still applies', () => {
    applyChanges(sink, [moved('e1', 100), moved('e2', 1100)]);
    ackAll();
    remote({ kind: 'element:upsert', element: stored(line('e1', 7777), 0) }); // Bob moves e1
    expect(undo()).toBe(true);
    expect(toasts).toEqual(['Changed by Bob']);
    expect(sends.at(-1)).toEqual([{ kind: 'element:upsert', element: line('e2', 1000) }]);
    ackAll();
    expect(xOf('e1')).toBe(7777); // Bob's change stays
    expect(xOf('e2')).toBe(1000);
    // only what was applied can be redone
    expect(history().redo[0]?.changes.map((c) => c.id)).toEqual(['e2']);
  });

  it('an element someone deleted is skipped, with the deleter’s name', () => {
    applyChanges(sink, [moved('e3', 2500)]);
    ackAll();
    remote({ kind: 'element:delete', elementId: 'e3' });
    undo();
    expect(toasts).toEqual(['Changed by Bob']);
    expect(view('e3')).toBeUndefined(); // not resurrected
    expect(history().redo).toHaveLength(0);
  });

  it('redo applies the same rule', () => {
    applyChanges(sink, [moved('e1', 100)]);
    ackAll();
    undo();
    ackAll();
    remote({ kind: 'element:upsert', element: stored(line('e1', 4444), 0) });
    redo();
    expect(toasts).toEqual(['Changed by Bob']);
    expect(xOf('e1')).toBe(4444);
  });
});

describe('stacks', () => {
  it('a new action clears the redo stack', () => {
    applyChanges(sink, [moved('e1', 100)]);
    ackAll();
    undo();
    ackAll();
    expect(history().redo).toHaveLength(1);
    applyChanges(sink, [moved('e2', 1500)]);
    expect(history().redo).toHaveLength(0);
    expect(redo()).toBe(false);
  });

  it('keeps at most 100 steps', () => {
    for (let i = 1; i <= MAX_HISTORY + 5; i++) applyChanges(sink, [moved('e1', i)]);
    expect(history().undo).toHaveLength(MAX_HISTORY);
  });

  it('a rejected op leaves the history (it never changed anything)', () => {
    applyChanges(sink, [moved('e1', 100), moved('e2', 1100)]);
    const rejected = store().pending[0]!.opId;
    store().reject(rejected);
    expect(history().undo[0]?.changes.map((c) => c.id)).toEqual(['e2']);
    store().reject(store().pending[0]!.opId);
    expect(history().undo).toHaveLength(0);
  });

  it('nothing to undo / redo → false', () => {
    expect(undo()).toBe(false);
    expect(redo()).toBe(false);
  });
});

describe('bulk-op rule (FEATURES F6)', () => {
  it('offline: an action bigger than the queue room left is refused whole, nothing queued', () => {
    online = false;
    const filler = Array.from({ length: MAX_PENDING - 2 }, (_, i) => {
      const id = uid();
      return { id, before: null, after: line(id, 10 + i) };
    });
    expect(applyChanges(sink, filler)).toBe('ok');
    expect(store().pending).toHaveLength(MAX_PENDING - 2);
    const three = [moved('e1', 1), moved('e2', 2), moved('e3', 3)];
    expect(applyChanges(sink, three)).toBe('refused');
    expect(store().pending).toHaveLength(MAX_PENDING - 2);
    expect(xOf('e1')).toBe(0);
    expect(applyChanges(sink, three.slice(0, 2))).toBe('ok'); // exactly fits
  });

  it('offline undo that does not fit is refused and the step stays on the stack', () => {
    applyChanges(sink, [moved('e1', 100), moved('e2', 1100)]);
    ackAll();
    online = false;
    const filler = Array.from({ length: MAX_PENDING - 1 }, (_, i) => {
      const id = uid();
      return { id, before: null, after: line(id, i) };
    });
    applyChanges(sink, filler);
    const steps = history().undo.length;
    undo(); // the filler step's undo needs 499 more ops: no room
    expect(toasts.at(-1)).toBe('Too many changes while offline — reconnect first');
    expect(history().undo).toHaveLength(steps);
  });

  it('online: a bulk action may exceed the queue cap (it leaves in ≤ 50-op batches)', () => {
    const many = Array.from({ length: MAX_PENDING + 20 }, () => {
      const id = uid();
      return { id, before: null, after: line(id) };
    });
    expect(applyChanges(sink, many)).toBe('ok');
    expect(store().pending).toHaveLength(MAX_PENDING + 20);
  });
});
