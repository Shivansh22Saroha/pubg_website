import type { PendingOp } from '@/stores/boardModel';

export const BATCH_MAX_OPS = 50;
const BATCH_MAX_BYTES = 60 * 1024;

/** Pending op → socket event + payload (same opId every time it is sent). */
export function toWire(p: PendingOp): { event: string; payload: unknown } {
  const { opId, boardId, op } = p;
  switch (op.kind) {
    case 'element:upsert':
      return { event: op.kind, payload: { opId, boardId, element: op.element } };
    case 'element:delete':
      return { event: op.kind, payload: { opId, boardId, elementId: op.elementId } };
    case 'layer:upsert':
      return { event: op.kind, payload: { opId, boardId, layer: op.layer } };
    case 'layer:delete':
    case 'layer:clear':
      return { event: op.kind, payload: { opId, boardId, layerId: op.layerId } };
    case 'layer:reorder':
      return { event: op.kind, payload: { opId, boardId, order: op.order } };
  }
}

/**
 * Groups pending ops into sends, in order: consecutive element ops of one board travel as
 * `element:batch` (≤ 50 ops, ≤ 60 KB); layer ops go alone. A one-op group is a plain emit.
 */
export function planSends(list: PendingOp[]): PendingOp[][] {
  const out: PendingOp[][] = [];
  let chunk: PendingOp[] = [];
  let bytes = 0;
  const close = () => {
    if (chunk.length > 0) out.push(chunk);
    chunk = [];
    bytes = 0;
  };
  for (const p of list) {
    const isElement = p.op.kind === 'element:upsert' || p.op.kind === 'element:delete';
    if (!isElement) {
      close();
      out.push([p]);
      continue;
    }
    const size = JSON.stringify(toWire(p).payload).length;
    const fits =
      chunk.length < BATCH_MAX_OPS &&
      bytes + size < BATCH_MAX_BYTES &&
      chunk[0]?.boardId === p.boardId;
    if (!fits) close();
    chunk.push(p);
    bytes += size;
  }
  close();
  return out;
}
