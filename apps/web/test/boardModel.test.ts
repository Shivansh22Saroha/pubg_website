import type { BoardOp, Element, ElementInput, Layer } from '@rotationlab/shared';
import { produce } from 'immer';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ackOp,
  addLocal,
  applyDelta,
  applyRemote,
  emptyModel,
  hasGap,
  loadFull,
  MAX_PENDING,
  rejectOp,
  type BoardModel,
  type LocalOp,
} from '@/stores/boardModel';

const BOARD = '0192f7a1-0000-7000-8000-00000000000b';
const ME = '0192f7a1-0000-7000-8000-0000000000aa';
const OTHER = '0192f7a1-0000-7000-8000-0000000000bb';
const L1 = '0192f7a1-0000-7000-8000-0000000000c1';
const L2 = '0192f7a1-0000-7000-8000-0000000000c2';
let n = 0;
const uid = () => `0192f7a1-0000-7000-8000-${String(++n).padStart(12, '0')}`;

const layer = (id: string, position: number, over: Partial<Layer> = {}): Layer => ({
  id,
  boardId: BOARD,
  name: `Layer ${position}`,
  color: '#F2A900',
  position,
  visible: true,
  locked: false,
  seq: 0,
  ...over,
});

const input = (id: string, color = '#F2A900', layerId = L1): ElementInput => ({
  id,
  boardId: BOARD,
  layerId,
  type: 'LINE',
  geometry: {
    points: [
      [0, 0],
      [100, 100],
    ],
  },
  style: { color, width: 4, dashed: false, fillOpacity: 0 },
  props: {},
  z: 0,
});

const element = (id: string, seq: number, color = '#F2A900', layerId = L1): Element => ({
  ...input(id, color, layerId),
  geometry: {
    points: [
      [0, 0],
      [100, 100],
    ],
  },
  props: {},
  seq,
  createdBy: OTHER,
  updatedBy: OTHER,
  updatedAt: '2026-10-25T10:00:00.000Z',
});

const remote = (seq: number, op: BoardOp['op'], opId = uid(), actorId = OTHER): BoardOp => ({
  boardId: BOARD,
  seq,
  actorId,
  opId,
  op,
});

let m: BoardModel;
/** runs a mutation through immer, like the store does */
const act = (fn: (d: BoardModel) => void) => {
  m = produce(m, fn);
};
const local = (op: LocalOp, opId = uid()) => {
  act((d) => {
    addLocal(d, { opId, boardId: BOARD, op });
  });
  return opId;
};

beforeEach(() => {
  m = emptyModel(ME);
  act((d) => {
    loadFull(d, BOARD, {
      mode: 'full',
      seq: 10,
      layers: [layer(L1, 0), layer(L2, 1)],
      elements: [element('e1', 5)],
    });
  });
});

describe('full load', () => {
  it('replaces confirmed, sets lastSeq and builds the view', () => {
    expect(m.lastSeq).toBe(10);
    expect(m.ready).toBe(true);
    expect(Object.keys(m.view.elements)).toEqual(['e1']);
    expect(m.view.layers.map((l) => l.id)).toEqual([L1, L2]);
  });

  it('keeps pending ops across a full reload and re-overlays them', () => {
    local({ kind: 'element:upsert', element: input('e2') });
    act((d) => {
      loadFull(d, BOARD, { mode: 'full', seq: 12, layers: [layer(L1, 0)], elements: [] });
    });
    expect(m.pending).toHaveLength(1);
    expect(Object.keys(m.view.elements)).toEqual(['e2']);
    expect(m.view.elements.e2?.pending).toBe(true);
  });
});

describe('incoming board:op (seq rule)', () => {
  it('applies only when op.seq > item.seq and advances lastSeq', () => {
    act((d) => {
      applyRemote(d, remote(11, { kind: 'element:upsert', element: element('e1', 0, '#EF4444') }));
    });
    expect(m.elements.e1?.seq).toBe(11);
    expect(m.view.elements.e1?.style.color).toBe('#EF4444');
    expect(m.lastSeq).toBe(11);
    // an older write for the same element is ignored
    act((d) => {
      applyRemote(d, remote(4, { kind: 'element:upsert', element: element('e1', 0, '#22C55E') }));
    });
    expect(m.view.elements.e1?.style.color).toBe('#EF4444');
  });

  it('a delete tombstone stops an older upsert from resurrecting the element', () => {
    act((d) => {
      applyRemote(d, remote(12, { kind: 'element:delete', elementId: 'e1' }));
      applyRemote(d, remote(11, { kind: 'element:upsert', element: element('e1', 0) }));
    });
    expect(m.view.elements.e1).toBeUndefined();
    expect(m.lastSeq).toBe(12);
  });

  it('keeps lastSeq contiguous: a gap holds it back until the missing seq arrives', () => {
    act((d) => {
      applyRemote(d, remote(12, { kind: 'element:upsert', element: element('e2', 0) }));
    });
    expect(m.lastSeq).toBe(10);
    expect(hasGap(m)).toBe(true);
    act((d) => {
      applyRemote(d, remote(11, { kind: 'element:upsert', element: element('e3', 0) }));
    });
    expect(m.lastSeq).toBe(12);
    expect(hasGap(m)).toBe(false);
  });

  it('ignores ops for another board', () => {
    act((d) => {
      applyRemote(d, {
        ...remote(11, { kind: 'element:delete', elementId: 'e1' }),
        boardId: OTHER,
      });
    });
    expect(m.view.elements.e1).toBeDefined();
  });

  it('memoises: an op only replaces the view entry it touched', () => {
    act((d) => {
      applyRemote(d, remote(11, { kind: 'element:upsert', element: element('e2', 0) }));
    });
    const e1Before = m.view.elements.e1;
    act((d) => {
      applyRemote(d, remote(12, { kind: 'element:upsert', element: element('e2', 0, '#EF4444') }));
    });
    expect(m.view.elements.e1).toBe(e1Before);
  });
});

describe('local ops, ack and reject', () => {
  it('shows a local op immediately as an overlay; ack moves it into confirmed', () => {
    const opId = local({ kind: 'element:upsert', element: input('e2', '#38BDF8') });
    expect(m.view.elements.e2).toMatchObject({ pending: true, style: { color: '#38BDF8' } });
    expect(m.elements.e2).toBeUndefined();
    act((d) => {
      ackOp(d, opId, 11);
    });
    expect(m.pending).toEqual([]);
    expect(m.elements.e2).toMatchObject({ seq: 11, updatedBy: ME, createdBy: ME });
    expect(m.view.elements.e2?.pending).toBeUndefined();
    expect(m.lastSeq).toBe(11);
  });

  it('reject drops the op: the overlay disappears (rollback)', () => {
    const opId = local({
      kind: 'element:upsert',
      element: { ...input('e1'), style: { ...input('e1').style, color: '#EF4444' } },
    });
    expect(m.view.elements.e1?.style.color).toBe('#EF4444');
    act((d) => {
      rejectOp(d, opId);
    });
    expect(m.view.elements.e1?.style.color).toBe('#F2A900');
    const del = local({ kind: 'element:delete', elementId: 'e1' });
    expect(m.view.elements.e1).toBeUndefined();
    act((d) => {
      rejectOp(d, del);
    });
    expect(m.view.elements.e1).toBeDefined();
  });

  it('applies several pending ops for one element in order', () => {
    local({ kind: 'element:upsert', element: input('e1', '#EF4444') });
    local({ kind: 'element:upsert', element: input('e1', '#22C55E') });
    expect(m.view.elements.e1?.style.color).toBe('#22C55E');
    local({ kind: 'element:delete', elementId: 'e1' });
    expect(m.view.elements.e1).toBeUndefined();
  });

  it('EDGE: remote higher-seq update arrives while our older op is pending; our lower-seq ack must not win', () => {
    const opId = local({ kind: 'element:upsert', element: input('e1', '#38BDF8') });
    // the server already ordered ours at 11, someone else's at 12; their broadcast arrives first
    act((d) => {
      applyRemote(d, remote(12, { kind: 'element:upsert', element: element('e1', 0, '#EF4444') }));
    });
    expect(m.elements.e1).toMatchObject({ seq: 12, style: { color: '#EF4444' } });
    expect(m.view.elements.e1?.style.color).toBe('#38BDF8'); // still overlaid by ours
    act((d) => {
      ackOp(d, opId, 11);
    });
    expect(m.elements.e1).toMatchObject({ seq: 12, style: { color: '#EF4444' } }); // confirmed = remote
    expect(m.view.elements.e1?.style.color).toBe('#EF4444');
    expect(m.pending).toEqual([]);
    expect(m.lastSeq).toBe(12);
  });

  it('our own op seen via a delta resync clears the pending entry (no duplicate)', () => {
    const opId = local({ kind: 'element:upsert', element: input('e2') });
    act((d) => {
      applyDelta(d, {
        mode: 'delta',
        seq: 11,
        ops: [remote(11, { kind: 'element:upsert', element: element('e2', 0) }, opId, ME)],
      });
    });
    expect(m.pending).toEqual([]);
    expect(m.view.elements.e2?.pending).toBeUndefined();
    expect(m.lastSeq).toBe(11);
  });

  it('caps the offline queue at 500 ops', () => {
    for (let i = 0; i < MAX_PENDING; i++) local({ kind: 'element:delete', elementId: `x${i}` });
    let accepted = true;
    act((d) => {
      accepted = addLocal(d, {
        opId: uid(),
        boardId: BOARD,
        op: { kind: 'element:delete', elementId: 'one-more' },
      });
    });
    expect(accepted).toBe(false);
    expect(m.pending).toHaveLength(MAX_PENDING);
  });

  it('pending ops for another board stay queued but out of this board’s view', () => {
    act((d) => {
      addLocal(d, {
        opId: uid(),
        boardId: OTHER,
        op: { kind: 'element:upsert', element: input('elsewhere') },
      });
    });
    expect(m.pending).toHaveLength(1);
    expect(m.view.elements.elsewhere).toBeUndefined();
  });
});

describe('layers', () => {
  it('layer delete / clear remove its elements (confirmed and overlay)', () => {
    act((d) => {
      applyRemote(
        d,
        remote(11, { kind: 'element:upsert', element: element('e2', 0, '#F2A900', L2) }),
      );
    });
    const opId = local({ kind: 'layer:clear', layerId: L2 });
    expect(m.view.elements.e2).toBeUndefined();
    act((d) => {
      rejectOp(d, opId);
    });
    expect(m.view.elements.e2).toBeDefined();
    act((d) => {
      applyRemote(d, remote(12, { kind: 'layer:delete', layerId: L2 }));
    });
    expect(m.view.elements.e2).toBeUndefined();
    expect(m.view.layers.map((l) => l.id)).toEqual([L1]);
  });

  it('reorder by seq; a pending layer:upsert appears at the end', () => {
    act((d) => {
      applyRemote(d, remote(11, { kind: 'layer:reorder', order: [L2, L1] }));
    });
    expect(m.view.layers.map((l) => l.id)).toEqual([L2, L1]);
    local({
      kind: 'layer:upsert',
      layer: { id: 'L3', name: 'New', color: '#22C55E', visible: true, locked: false },
    });
    expect(m.view.layers.map((l) => l.id)).toEqual([L2, L1, 'L3']);
    // an older reorder is ignored
    act((d) => {
      applyRemote(d, remote(9, { kind: 'layer:reorder', order: [L1, L2] }));
    });
    expect(m.view.layers.slice(0, 2).map((l) => l.id)).toEqual([L2, L1]);
  });
});

describe('delta resync', () => {
  it('applies the missing ops in order and adopts the server seq', () => {
    act((d) => {
      applyDelta(d, {
        mode: 'delta',
        seq: 13,
        ops: [
          remote(11, { kind: 'element:upsert', element: element('e2', 0) }),
          remote(12, { kind: 'element:upsert', element: element('e2', 0, '#EF4444') }),
          remote(13, { kind: 'element:delete', elementId: 'e1' }),
        ],
      });
    });
    expect(m.lastSeq).toBe(13);
    expect(Object.keys(m.view.elements)).toEqual(['e2']);
    expect(m.view.elements.e2?.style.color).toBe('#EF4444');
  });
});
