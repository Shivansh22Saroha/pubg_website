import type {
  BoardOp,
  BoardSubscribeAck,
  Element,
  ElementInput,
  Layer,
  LayerInput,
  OpBody,
} from '@rotationlab/shared';

/**
 * Board state model (ARCHITECTURE §7) — "confirmed + pending overlay":
 *
 * - `confirmed`: elements/layers exactly as the server ordered them. Every item carries the seq
 *   of its last write; a write only lands if its seq is higher (last-writer-wins). Deletes leave
 *   a tombstone seq so a late, older upsert can't resurrect an element.
 * - `pending`: local ops not yet acknowledged, in the order they were made, each keyed by opId.
 * - `view`: confirmed with pending applied on top, recomputed only for the ids an action
 *   touched — unchanged elements keep object identity, so the renderer can diff by reference.
 *
 * Everything here is a plain function over a draft, so it runs inside immer and in unit tests.
 */

export type LocalOp =
  | { kind: 'element:upsert'; element: ElementInput }
  | { kind: 'element:delete'; elementId: string }
  | { kind: 'layer:upsert'; layer: LayerInput }
  | { kind: 'layer:delete'; layerId: string }
  | { kind: 'layer:reorder'; order: string[] }
  | { kind: 'layer:clear'; layerId: string };

export interface PendingOp {
  opId: string;
  boardId: string;
  op: LocalOp;
}

export type ViewElement = Element & { pending?: true };

// ---- undo / redo (ARCHITECTURE §7.5) ---------------------------------------------------------

/**
 * One element's part of a user action: its state before and after (null = didn't exist /
 * deleted). Undo re-applies `before`, redo `after` — both as ordinary ops with new opIds.
 */
export interface Change {
  id: string;
  before: ElementInput | null;
  after: ElementInput | null;
}

/** One undo step = one user action (a create, a batch move, an erase sweep, a style change). */
export interface HistoryStep {
  changes: Change[];
  /** element id → opId of the op that applied this step's state (to drop it on reject) */
  opIds: Record<string, string>;
}

export interface History {
  undo: HistoryStep[];
  redo: HistoryStep[];
}

export const MAX_HISTORY = 100;

export interface BoardModel {
  boardId: string | null;
  meId: string;
  /** highest seq up to which every op has been applied (contiguous) */
  lastSeq: number;
  /** applied seqs above lastSeq (a gap means an op is still in flight / missing) */
  seenAbove: number[];
  elements: Record<string, Element>;
  layers: Record<string, Layer>;
  /** seq of the last layer:reorder applied */
  orderSeq: number;
  /** id → seq of the delete that removed it */
  tombstones: Record<string, number>;
  /** every board's unacknowledged ops, in creation order (offline queue) */
  pending: PendingOp[];
  view: { elements: Record<string, ViewElement>; layers: Layer[] };
  ready: boolean;
  /** per board, this session only (FEATURES F6: 100 steps, not persisted) */
  history: Record<string, History>;
  /**
   * element id → the newest seq this user has acted on: the confirmed seq an edit was based on
   * when it was made, raised to the seq of their own op once acknowledged (undo's seq rule)
   */
  mySeq: Record<string, number>;
  /** element id → who removed it (delete / layer clear / layer delete), for "Changed by" */
  removedBy: Record<string, string | null>;
}

export const MAX_PENDING = 500;

export function emptyModel(meId = ''): BoardModel {
  return {
    boardId: null,
    meId,
    lastSeq: 0,
    seenAbove: [],
    elements: {},
    layers: {},
    orderSeq: 0,
    tombstones: {},
    pending: [],
    view: { elements: {}, layers: [] },
    ready: false,
    history: {},
    mySeq: {},
    removedBy: {},
  };
}

// ---- seq bookkeeping ----------------------------------------------------------------------

function markSeen(m: BoardModel, seq: number) {
  if (seq <= m.lastSeq || m.seenAbove.includes(seq)) return;
  m.seenAbove.push(seq);
  m.seenAbove.sort((a, b) => a - b);
  while (m.seenAbove[0] === m.lastSeq + 1) {
    m.lastSeq += 1;
    m.seenAbove.shift();
  }
}

// ---- confirmed state (server order) ----------------------------------------------------------

/** Applies one server-ordered op to `confirmed`. Returns the element ids whose view may change. */
function applyConfirmed(
  m: BoardModel,
  body: OpBody,
  seq: number,
): { ids: string[]; layers: boolean } {
  switch (body.kind) {
    case 'element:upsert': {
      const el = body.element;
      const cur = m.elements[el.id];
      if (cur && seq <= cur.seq) return { ids: [], layers: false };
      if ((m.tombstones[el.id] ?? -1) >= seq) return { ids: [], layers: false };
      m.elements[el.id] = { ...el, seq };
      return { ids: [el.id], layers: false };
    }
    case 'element:delete': {
      const cur = m.elements[body.elementId];
      if (cur && seq <= cur.seq) return { ids: [], layers: false };
      Reflect.deleteProperty(m.elements, body.elementId);
      m.tombstones[body.elementId] = Math.max(m.tombstones[body.elementId] ?? 0, seq);
      return { ids: [body.elementId], layers: false };
    }
    case 'layer:upsert': {
      const cur = m.layers[body.layer.id];
      if (cur && seq <= cur.seq) return { ids: [], layers: false };
      if ((m.tombstones[body.layer.id] ?? -1) >= seq) return { ids: [], layers: false };
      // the server's position is authoritative unless a later reorder already moved it
      const position = cur && m.orderSeq > seq ? cur.position : body.layer.position;
      m.layers[body.layer.id] = { ...body.layer, seq, position };
      return { ids: elementsOnLayer(m, body.layer.id), layers: true };
    }
    case 'layer:delete':
    case 'layer:clear': {
      const ids = removeLayerElements(m, body.layerId, seq);
      if (body.kind === 'layer:delete') {
        const cur = m.layers[body.layerId];
        if (!cur || seq > cur.seq) {
          Reflect.deleteProperty(m.layers, body.layerId);
          m.tombstones[body.layerId] = seq;
          resequence(
            m,
            Object.values(m.layers)
              .sort((a, b) => a.position - b.position)
              .map((l) => l.id),
          );
        }
      }
      return { ids, layers: body.kind === 'layer:delete' };
    }
    case 'layer:reorder': {
      if (seq <= m.orderSeq) return { ids: [], layers: false };
      m.orderSeq = seq;
      resequence(m, body.order);
      return { ids: [], layers: true };
    }
  }
}

function elementsOnLayer(m: BoardModel, layerId: string): string[] {
  return Object.values(m.elements)
    .filter((e) => e.layerId === layerId)
    .map((e) => e.id);
}

function removeLayerElements(m: BoardModel, layerId: string, seq: number): string[] {
  const ids: string[] = [];
  for (const el of Object.values(m.elements)) {
    if (el.layerId !== layerId || el.seq > seq) continue;
    Reflect.deleteProperty(m.elements, el.id);
    m.tombstones[el.id] = Math.max(m.tombstones[el.id] ?? 0, seq);
    ids.push(el.id);
  }
  return ids;
}

function resequence(m: BoardModel, order: string[]) {
  order.forEach((id, position) => {
    const l = m.layers[id];
    if (l) l.position = position;
  });
}

// ---- pending overlay -------------------------------------------------------------------------

function pendingForActive(m: BoardModel): PendingOp[] {
  return m.pending.filter((p) => p.boardId === m.boardId);
}

/** Element ids a pending op affects (layer-wide ops touch every element on the layer). */
function idsTouchedBy(m: BoardModel, op: LocalOp): { ids: string[]; layers: boolean } {
  switch (op.kind) {
    case 'element:upsert':
      return { ids: [op.element.id], layers: false };
    case 'element:delete':
      return { ids: [op.elementId], layers: false };
    case 'layer:upsert':
      return { ids: elementsInView(m, op.layer.id), layers: true };
    case 'layer:delete':
    case 'layer:clear':
      return { ids: elementsInView(m, op.layerId), layers: op.kind === 'layer:delete' };
    case 'layer:reorder':
      return { ids: [], layers: true };
  }
}

function elementsInView(m: BoardModel, layerId: string): string[] {
  const ids = new Set(elementsOnLayer(m, layerId));
  for (const v of Object.values(m.view.elements)) if (v.layerId === layerId) ids.add(v.id);
  return [...ids];
}

/** Confirmed element + every pending op of the active board that touches it, in order. */
function computeElement(m: BoardModel, id: string, pending: PendingOp[]): ViewElement | undefined {
  let el: ViewElement | undefined = m.elements[id];
  for (const { op } of pending) {
    switch (op.kind) {
      case 'element:upsert':
        if (op.element.id === id) {
          el = {
            ...op.element,
            seq: el?.seq ?? 0,
            createdBy: el?.createdBy ?? m.meId,
            updatedBy: m.meId,
            updatedAt: el?.updatedAt ?? new Date(0).toISOString(),
            pending: true,
          };
        }
        break;
      case 'element:delete':
        if (op.elementId === id) el = undefined;
        break;
      case 'layer:delete':
      case 'layer:clear':
        if (el && el.layerId === op.layerId) el = undefined;
        break;
      default:
        break;
    }
  }
  return el;
}

function computeLayers(m: BoardModel, pending: PendingOp[]): Layer[] {
  const layers: Record<string, Layer> = { ...m.layers };
  for (const { op } of pending) {
    if (op.kind === 'layer:upsert') {
      const cur = layers[op.layer.id];
      layers[op.layer.id] = {
        ...op.layer,
        boardId: m.boardId ?? '',
        position: cur?.position ?? Object.keys(layers).length,
        seq: cur?.seq ?? 0,
      };
    } else if (op.kind === 'layer:delete') {
      Reflect.deleteProperty(layers, op.layerId);
    } else if (op.kind === 'layer:reorder') {
      op.order.forEach((id, position) => {
        const l = layers[id];
        if (l) layers[id] = { ...l, position };
      });
    }
  }
  return Object.values(layers).sort((a, b) => a.position - b.position);
}

/** Recomputes only the given ids (and the layer list when asked) — memoised view. */
function refreshView(m: BoardModel, ids: Iterable<string>, layers: boolean) {
  const pending = pendingForActive(m);
  for (const id of new Set(ids)) {
    const next = computeElement(m, id, pending);
    if (next) m.view.elements[id] = next;
    else Reflect.deleteProperty(m.view.elements, id);
  }
  if (layers) m.view.layers = computeLayers(m, pending);
}

// ---- actions ---------------------------------------------------------------------------------

/** `board:subscribe` full mode (or a new board): replace confirmed, keep the pending queue. */
export function loadFull(
  m: BoardModel,
  boardId: string,
  ack: Extract<BoardSubscribeAck, { mode: 'full' }>,
) {
  m.boardId = boardId;
  m.lastSeq = ack.seq;
  m.seenAbove = [];
  m.tombstones = {};
  m.orderSeq = ack.seq;
  m.elements = Object.fromEntries(ack.elements.map((e) => [e.id, e]));
  m.layers = Object.fromEntries(ack.layers.map((l) => [l.id, l]));
  m.view = { elements: {}, layers: [] };
  const ids = new Set([
    ...Object.keys(m.elements),
    ...pendingForActive(m).flatMap((p) => idsTouchedBy(m, p.op).ids),
  ]);
  refreshView(m, ids, true);
  m.ready = true;
}

/** A broadcast `board:op`, or one entry of a delta resync. Also clears a matching pending op. */
export function applyRemote(m: BoardModel, op: BoardOp) {
  if (op.boardId !== m.boardId) return;
  const { ids, layers } = applyConfirmed(m, op.op, op.seq);
  markSeen(m, op.seq);
  const body = op.op;
  if (body.kind === 'element:delete') m.removedBy[body.elementId] = op.actorId;
  else if (body.kind === 'layer:clear' || body.kind === 'layer:delete')
    for (const id of ids) m.removedBy[id] = op.actorId;
  const idx = m.pending.findIndex((p) => p.opId === op.opId); // our own op, seen via resync
  let touched = { ids: [] as string[], layers: false };
  const mine = m.pending[idx];
  if (mine) {
    touched = idsTouchedBy(m, mine.op);
    m.pending.splice(idx, 1);
    noteMine(m, mine.op, op.seq);
  }
  refreshView(m, [...ids, ...touched.ids], layers || touched.layers);
}

export function applyDelta(m: BoardModel, ack: Extract<BoardSubscribeAck, { mode: 'delta' }>) {
  for (const op of ack.ops) applyRemote(m, op);
  // the server's seq is authoritative: everything ≤ it has now been applied
  if (ack.seq > m.lastSeq) {
    m.lastSeq = ack.seq;
    m.seenAbove = m.seenAbove.filter((s) => s > ack.seq);
  }
}

/**
 * A bulk local edit (FEATURES F6 "Bulk operations"): all ops or none. Offline, it is refused
 * whole when it needs more room than the queue has left; online the queue may briefly go past
 * the cap, since the ops leave in ≤ 50-op batches right away.
 */
export function addLocalMany(m: BoardModel, list: PendingOp[], online: boolean): boolean {
  if (list.length === 0) return true;
  if (!online && m.pending.length + list.length > MAX_PENDING) return false;
  m.pending.push(...list);
  for (const p of list) noteBase(m, p.op);
  const ids: string[] = [];
  let layers = false;
  for (const p of list) {
    if (p.boardId !== m.boardId) continue;
    const t = idsTouchedBy(m, p.op);
    ids.push(...t.ids);
    layers ||= t.layers;
  }
  refreshView(m, ids, layers);
  return true;
}

/** A local edit: queued, shown immediately via the overlay. Returns false when the queue is full. */
export function addLocal(m: BoardModel, pending: PendingOp): boolean {
  if (m.pending.length >= MAX_PENDING) return false;
  m.pending.push(pending);
  noteBase(m, pending.op);
  if (pending.boardId === m.boardId) {
    const t = idsTouchedBy(m, pending.op);
    refreshView(m, t.ids, t.layers);
  }
  return true;
}

/** Turns an acknowledged local op into the server-ordered body it became. */
function toConfirmedBody(m: BoardModel, p: PendingOp): OpBody {
  const op = p.op;
  switch (op.kind) {
    case 'element:upsert': {
      const prev = m.elements[op.element.id];
      return {
        kind: 'element:upsert',
        element: {
          ...op.element,
          seq: 0,
          createdBy: prev?.createdBy ?? m.meId,
          updatedBy: m.meId,
          updatedAt: new Date().toISOString(),
        },
      };
    }
    case 'layer:upsert': {
      const prev = m.layers[op.layer.id];
      return {
        kind: 'layer:upsert',
        layer: {
          ...op.layer,
          boardId: p.boardId,
          position: prev?.position ?? Object.keys(m.layers).length,
          seq: 0,
        },
      };
    }
    default:
      return op;
  }
}

/** Ack `{ seq }`: the op joins confirmed under the seq rule and leaves the overlay. */
export function ackOp(m: BoardModel, opId: string, seq: number) {
  const idx = m.pending.findIndex((p) => p.opId === opId);
  const p = m.pending[idx];
  if (!p) return;
  m.pending.splice(idx, 1);
  noteMine(m, p.op, seq);
  if (p.boardId !== m.boardId) return; // acked while we're on another board — next load has it
  const touched = idsTouchedBy(m, p.op);
  const { ids, layers } = applyConfirmed(m, toConfirmedBody(m, p), seq);
  markSeen(m, seq);
  refreshView(m, [...touched.ids, ...ids], touched.layers || layers);
}

/** Reject: drop the op — the overlay disappears, which is the rollback. */
export function rejectOp(m: BoardModel, opId: string): PendingOp | undefined {
  const idx = m.pending.findIndex((p) => p.opId === opId);
  if (idx === -1) return undefined;
  const [p] = m.pending.splice(idx, 1);
  if (p && p.boardId === m.boardId) {
    const t = idsTouchedBy(m, p.op);
    refreshView(m, t.ids, t.layers);
  }
  if (p) forgetOp(m, p.boardId, opId);
  return p;
}

/** True while some seq above lastSeq arrived before the one right after it. */
export function hasGap(m: BoardModel): boolean {
  return m.seenAbove.length > 0;
}

// ---- history -----------------------------------------------------------------------------

/** A local edit is based on the element as confirmed right now. */
function noteBase(m: BoardModel, op: LocalOp) {
  const id =
    op.kind === 'element:upsert'
      ? op.element.id
      : op.kind === 'element:delete'
        ? op.elementId
        : undefined;
  if (id === undefined) return;
  const seen = m.elements[id]?.seq ?? m.tombstones[id] ?? 0;
  m.mySeq[id] = Math.max(m.mySeq[id] ?? 0, seen);
}

function noteMine(m: BoardModel, op: LocalOp, seq: number) {
  if (op.kind === 'element:upsert') {
    m.mySeq[op.element.id] = Math.max(m.mySeq[op.element.id] ?? 0, seq);
  } else if (op.kind === 'element:delete') {
    m.mySeq[op.elementId] = Math.max(m.mySeq[op.elementId] ?? 0, seq);
    m.removedBy[op.elementId] = m.meId;
  }
}

/**
 * Pushes a step. `action` = a new user action (clears redo); `undo` = the step just undone
 * goes to the redo stack; `redo` = the step just redone goes back on the undo stack.
 */
export function pushHistory(
  m: BoardModel,
  boardId: string,
  step: HistoryStep,
  kind: 'action' | 'undo' | 'redo',
) {
  if (step.changes.length === 0) return;
  const h = (m.history[boardId] ??= { undo: [], redo: [] });
  if (kind === 'action') h.redo = [];
  const stack = kind === 'undo' ? h.redo : h.undo;
  stack.push(step);
  if (stack.length > MAX_HISTORY) stack.shift();
}

export function popHistory(
  m: BoardModel,
  boardId: string,
  dir: 'undo' | 'redo',
): HistoryStep | undefined {
  return m.history[boardId]?.[dir].pop();
}

/** A rejected op never changed anything: its change leaves whichever step holds it. */
function forgetOp(m: BoardModel, boardId: string, opId: string) {
  const h = m.history[boardId];
  if (!h) return;
  for (const stack of [h.undo, h.redo]) {
    for (const step of stack) {
      const id = Object.keys(step.opIds).find((k) => step.opIds[k] === opId);
      if (id === undefined) continue;
      step.changes = step.changes.filter((c) => c.id !== id);
      Reflect.deleteProperty(step.opIds, id);
    }
    const kept = stack.filter((st) => st.changes.length > 0);
    stack.splice(0, stack.length, ...kept);
  }
}

export interface PlannedStep {
  /** the changes that still apply, as recorded (undo writes `before`, redo writes `after`) */
  apply: Change[];
  /** elements someone else changed since the step was recorded (and who did it) */
  skipped: { id: string; by: string | null }[];
}

/**
 * Undo / redo planning with the seq rule (ARCHITECTURE §7.5). Each element must still be as
 * this user left it: present or absent as expected and, when present, with no confirmed write
 * newer than the newest seq this user acted on (`mySeq`). Anything else was changed by someone
 * else and is skipped; the rest of the step still applies.
 */
export function planHistory(m: BoardModel, step: HistoryStep, dir: 'undo' | 'redo'): PlannedStep {
  const out: PlannedStep = { apply: [], skipped: [] };
  for (const c of step.changes) {
    const expected = dir === 'undo' ? c.after : c.before;
    const view = m.view.elements[c.id];
    const confirmed = m.elements[c.id];
    const shouldExist = expected !== null;
    if (shouldExist !== (view !== undefined)) {
      out.skipped.push({ id: c.id, by: view ? view.updatedBy : (m.removedBy[c.id] ?? null) });
    } else if (confirmed && confirmed.seq > (m.mySeq[c.id] ?? 0)) {
      out.skipped.push({ id: c.id, by: confirmed.updatedBy });
    } else {
      out.apply.push(c);
    }
  }
  return out;
}

/** Undo / redo availability for the toolbar. */
export function historySize(m: BoardModel, boardId: string | null): { undo: number; redo: number } {
  const h = boardId ? m.history[boardId] : undefined;
  return { undo: h?.undo.length ?? 0, redo: h?.redo.length ?? 0 };
}
