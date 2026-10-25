import { Prisma, type Element as ElementRow, type PrismaClient } from '@prisma/client';
import {
  can,
  ELEMENT_LIMITS,
  elementJsonBytes,
  elementWithinWorld,
  MAPS,
  ROOM_LIMITS,
  type BoardOp,
  type BoardSubscribeAck,
  type Element,
  type ElementInput,
  type LayerInput,
  type OpBody,
  type RoomRole,
} from '@rotationlab/shared';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import type { AuthUser } from '../../lib/policy.js';
import { toLayer, toMapId } from '../rooms/mappers.js';
import type { RoomPolicy } from '../rooms/policy.js';
import { touchRoom } from '../rooms/service.js';

/** One durable op as requested by a client (API_SPEC §7.2). */
export type OpRequest =
  | { opId: string; kind: 'element:upsert'; element: ElementInput }
  | { opId: string; kind: 'element:delete'; elementId: string }
  | { opId: string; kind: 'layer:upsert'; layer: LayerInput }
  | { opId: string; kind: 'layer:delete'; layerId: string }
  | { opId: string; kind: 'layer:reorder'; order: string[] }
  | { opId: string; kind: 'layer:clear'; layerId: string };

export interface ApplyResult {
  /** applied ops to broadcast (empty for a replay) */
  ops: BoardOp[];
  /** one seq per requested op, in order */
  seqs: number[];
  roomId: string;
  /** true when every op was already applied earlier (duplicate opId) — nothing to broadcast */
  replay: boolean;
}

const OP_TTL_SEC = 600; // ARCHITECTURE §7.4: 10-minute opId dedupe window
const opKey = (userId: string, opId: string) => `rl:op:${userId}:${opId}`;
const PENDING = 'pending';

export function toElement(e: ElementRow): Element {
  return {
    id: e.id,
    boardId: e.boardId,
    layerId: e.layerId,
    type: e.type,
    geometry: e.geometry as Record<string, unknown>,
    style: e.style as Element['style'],
    props: e.props as Record<string, unknown>,
    z: e.z,
    seq: Number(e.seq),
    createdBy: e.createdBy,
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt.toISOString(),
  };
}

type Tx = Prisma.TransactionClient;

/**
 * Durable board ops (ARCHITECTURE §7.2). Every message runs in one transaction that row-locks
 * the board, allocates consecutive seqs (`last_seq + 1 …`), applies the ops, writes the op log
 * and keeps `element_count` exact. All-or-nothing: any failing op rolls the whole message back.
 * Conflicts resolve last-writer-wins by seq.
 */
export function createBoardOpsService(d: {
  prisma: PrismaClient;
  redis: Redis;
  policy: RoomPolicy;
}) {
  const { prisma, redis, policy } = d;

  function validate(boardId: string, worldSize: number, ops: OpRequest[]) {
    for (const op of ops) {
      if (op.kind !== 'element:upsert') continue;
      const el = op.element;
      if (el.boardId !== boardId)
        throw new AppError('BAD_REQUEST', 'Element belongs to another board');
      if (!elementWithinWorld(el, worldSize)) {
        throw new AppError('VALIDATION_ERROR', 'Element is outside the map', [
          { path: 'element.geometry', issue: 'out_of_bounds' },
        ]);
      }
      if (elementJsonBytes(el) > ELEMENT_LIMITS.elementJsonBytes) {
        throw new AppError('PAYLOAD_TOO_LARGE', 'Element is too large');
      }
    }
  }

  async function lockedLayer(tx: Tx, boardId: string, layerId: string) {
    const layer = await tx.layer.findFirst({ where: { id: layerId, boardId } });
    if (!layer) throw new AppError('NOT_FOUND', 'Layer not found');
    return layer;
  }

  async function resequenceLayers(tx: Tx, ids: string[]) {
    for (const [position, id] of ids.entries())
      await tx.layer.update({ where: { id }, data: { position } });
  }

  /** Applies one op at `seq`; returns the broadcast body and the element-count delta. */
  async function applyOne(
    tx: Tx,
    boardId: string,
    user: AuthUser,
    role: RoomRole,
    op: OpRequest,
    seq: bigint,
    elementCount: number,
  ): Promise<{ body: OpBody; delta: number }> {
    switch (op.kind) {
      case 'element:upsert': {
        const el = op.element;
        const layer = await lockedLayer(tx, boardId, el.layerId);
        if (layer.locked) throw new AppError('FORBIDDEN', 'Layer is locked');
        const existing = await tx.element.findUnique({
          where: { id: el.id },
          include: { layer: true },
        });
        if (existing && existing.boardId !== boardId)
          throw new AppError('FORBIDDEN', 'Element id belongs to another board');
        if (existing?.layer.locked) throw new AppError('FORBIDDEN', 'Layer is locked');
        if (!existing && elementCount + 1 > ELEMENT_LIMITS.maxElementsPerBoard) {
          throw new AppError(
            'LIMIT_REACHED',
            `A board can hold at most ${ELEMENT_LIMITS.maxElementsPerBoard} elements`,
          );
        }
        const data = {
          layerId: el.layerId,
          type: el.type,
          geometry: el.geometry as Prisma.InputJsonValue,
          style: el.style as Prisma.InputJsonValue,
          props: el.props as Prisma.InputJsonValue,
          z: el.z,
          seq,
          updatedBy: user.id,
        };
        const row = await tx.element.upsert({
          where: { id: el.id },
          create: { id: el.id, boardId, createdBy: user.id, ...data },
          update: data,
        });
        return {
          body: { kind: 'element:upsert', element: toElement(row) },
          delta: existing ? 0 : 1,
        };
      }
      case 'element:delete': {
        const existing = await tx.element.findFirst({
          where: { id: op.elementId, boardId },
          include: { layer: true },
        });
        if (existing?.layer.locked) throw new AppError('FORBIDDEN', 'Layer is locked');
        if (existing) await tx.element.delete({ where: { id: existing.id } });
        // deleting something already gone still gets a seq, so every client converges
        return {
          body: { kind: 'element:delete', elementId: op.elementId },
          delta: existing ? -1 : 0,
        };
      }
      case 'layer:upsert': {
        const l = op.layer;
        const existing = await tx.layer.findUnique({ where: { id: l.id } });
        if (existing && existing.boardId !== boardId)
          throw new AppError('FORBIDDEN', 'Layer id belongs to another board');
        // lock/unlock — and editing a locked layer — is OWNER-only (SECURITY §3)
        const touchesLock = existing ? existing.locked || existing.locked !== l.locked : l.locked;
        if (touchesLock && !can(role, 'layer.lock')) {
          throw new AppError(
            'FORBIDDEN',
            'Only the room owner can lock, unlock or edit locked layers',
          );
        }
        let row;
        if (existing) {
          row = await tx.layer.update({
            where: { id: l.id },
            data: { name: l.name, color: l.color, visible: l.visible, locked: l.locked, seq },
          });
        } else {
          const count = await tx.layer.count({ where: { boardId } });
          if (count >= ROOM_LIMITS.maxLayers) {
            throw new AppError(
              'LIMIT_REACHED',
              `A board can have at most ${ROOM_LIMITS.maxLayers} layers`,
            );
          }
          row = await tx.layer.create({
            data: {
              id: l.id,
              boardId,
              name: l.name,
              color: l.color,
              visible: l.visible,
              locked: l.locked,
              position: count,
              seq,
            },
          });
        }
        return { body: { kind: 'layer:upsert', layer: toLayer(row) }, delta: 0 };
      }
      case 'layer:delete': {
        const target = await lockedLayer(tx, boardId, op.layerId);
        if (target.locked && !can(role, 'layer.lock')) {
          throw new AppError('FORBIDDEN', 'Only the room owner can delete a locked layer');
        }
        const ids = (
          await tx.layer.findMany({
            where: { boardId },
            orderBy: { position: 'asc' },
            select: { id: true },
          })
        ).map((l) => l.id);
        if (ids.length <= 1)
          throw new AppError('CONFLICT', "A board's last layer can't be deleted");
        const removed = await tx.element.count({ where: { layerId: op.layerId } });
        await tx.layer.delete({ where: { id: op.layerId } }); // cascades its elements
        await resequenceLayers(
          tx,
          ids.filter((id) => id !== op.layerId),
        );
        return { body: { kind: 'layer:delete', layerId: op.layerId }, delta: -removed };
      }
      case 'layer:reorder': {
        const ids = (await tx.layer.findMany({ where: { boardId }, select: { id: true } })).map(
          (l) => l.id,
        );
        const same =
          op.order.length === ids.length &&
          new Set(op.order).size === ids.length &&
          op.order.every((id) => ids.includes(id));
        if (!same)
          throw new AppError(
            'BAD_REQUEST',
            'Order must list every layer of the board exactly once',
          );
        await resequenceLayers(tx, op.order);
        return { body: { kind: 'layer:reorder', order: op.order }, delta: 0 };
      }
      case 'layer:clear': {
        const layer = await lockedLayer(tx, boardId, op.layerId);
        if (layer.locked) throw new AppError('FORBIDDEN', 'Layer is locked');
        const { count } = await tx.element.deleteMany({ where: { layerId: op.layerId } });
        // TODO(phase8): auto-snapshot before a clear, like snapshot restore does
        return { body: { kind: 'layer:clear', layerId: op.layerId }, delta: -count };
      }
    }
  }

  return {
    async apply(user: AuthUser, boardId: string, ops: OpRequest[]): Promise<ApplyResult> {
      const { board, role } = await policy.requireBoard(user, boardId, 'board.edit');
      if (ops.length === 0) throw new AppError('BAD_REQUEST', 'No ops');

      // Idempotency per op (ARCHITECTURE §7.4): every opId remembers its seq for 10 min. A
      // resent message — single op or a batch that mixes applied and unapplied ops — returns
      // the original seq for ops already applied and applies (and broadcasts) only the rest.
      const keys = ops.map((o) => opKey(user.id, o.opId));
      const prior = await redis.mget(keys);
      if (prior.some((v) => v === PENDING)) {
        throw new AppError('CONFLICT', 'This op is already being applied');
      }
      const known = prior.map((v) => (v === null ? null : Number(v)));
      // ops not applied yet, each paired with its dedupe key
      const todoPairs = ops.flatMap((op, i) =>
        known[i] === null ? [{ op, key: keys[i] ?? '' }] : [],
      );
      if (todoPairs.length === 0) {
        return { roomId: board.roomId, replay: true, ops: [], seqs: known.map((v) => v ?? 0) };
      }
      const claimed: string[] = [];
      for (const { key } of todoPairs) {
        if ((await redis.set(key, PENDING, 'EX', OP_TTL_SEC, 'NX')) === null) {
          if (claimed.length > 0) await redis.del(...claimed);
          throw new AppError('CONFLICT', 'This op is already being applied');
        }
        claimed.push(key);
      }
      const todo = todoPairs.map((t) => t.op);

      try {
        validate(boardId, MAPS[toMapId(board.mapId)].worldSize, todo);
        const result = await prisma.$transaction(async (tx) => {
          const [locked] = await tx.$queryRaw<{ last_seq: bigint; element_count: number }[]>`
            SELECT last_seq, element_count FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
          if (!locked) throw new AppError('NOT_FOUND', 'Board not found');
          let seq = locked.last_seq;
          let count = locked.element_count;
          const out: BoardOp[] = [];
          for (const op of todo) {
            seq += 1n;
            const { body, delta } = await applyOne(tx, boardId, user, role, op, seq, count);
            count += delta;
            await tx.boardOp.create({
              data: {
                boardId,
                seq,
                opId: op.opId,
                actorId: user.id,
                kind: op.kind,
                payload: body as unknown as Prisma.InputJsonValue,
              },
            });
            out.push({ boardId, seq: Number(seq), actorId: user.id, opId: op.opId, op: body });
          }
          await tx.board.update({
            where: { id: boardId },
            data: { lastSeq: seq, elementCount: count },
          });
          return out;
        });
        const pipe = redis.multi();
        result.forEach((o, n) =>
          pipe.set(todoPairs[n]?.key ?? '', String(o.seq), 'EX', OP_TTL_SEC),
        );
        await pipe.exec();
        await touchRoom(prisma, board.roomId);
        let next = 0;
        const seqs = known.map((seq) => seq ?? result[next++]?.seq ?? 0);
        return { ops: result, seqs, roomId: board.roomId, replay: false };
      } catch (err) {
        await redis.del(...claimed); // let the client retry after fixing the op
        throw err;
      }
    },

    /**
     * `board:subscribe` (ARCHITECTURE §7.4): delta when the op log still holds every op after
     * `sinceSeq`, otherwise a full snapshot read consistently with its seq.
     */
    async subscribe(
      user: AuthUser,
      boardId: string,
      sinceSeq?: number,
    ): Promise<{ ack: BoardSubscribeAck; roomId: string }> {
      const { board } = await policy.requireBoard(user, boardId, 'room.view');
      const last = Number(board.lastSeq);
      if (sinceSeq !== undefined && sinceSeq <= last) {
        const logged = await prisma.boardOp.findMany({
          where: { boardId, seq: { gt: BigInt(sinceSeq) } },
          orderBy: { seq: 'asc' },
        });
        const contiguous =
          logged.length === last - sinceSeq &&
          (logged.length === 0 || Number(logged[0]?.seq) === sinceSeq + 1);
        if (contiguous) {
          return {
            roomId: board.roomId,
            ack: {
              mode: 'delta',
              seq: last,
              ops: logged.map((o) => ({
                boardId,
                seq: Number(o.seq),
                actorId: o.actorId,
                opId: o.opId,
                op: o.payload as OpBody,
              })),
            },
          };
        }
      }
      const full = await prisma.$transaction(
        async (tx) => {
          const b = await tx.board.findUniqueOrThrow({ where: { id: boardId } });
          const layers = await tx.layer.findMany({
            where: { boardId },
            orderBy: { position: 'asc' },
          });
          const elements = await tx.element.findMany({
            where: { boardId },
            orderBy: [{ z: 'asc' }, { seq: 'asc' }],
          });
          return {
            layers: layers.map(toLayer),
            elements: elements.map(toElement),
            seq: Number(b.lastSeq),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { roomId: board.roomId, ack: { mode: 'full', ...full } };
    },
  };
}
export type BoardOpsService = ReturnType<typeof createBoardOpsService>;

/** Op-log retention (ARCHITECTURE §11): drop ops older than 24 h or beyond the last 1 000. */
export async function pruneBoardOps(prisma: PrismaClient): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM board_ops o USING boards b
    WHERE o.board_id = b.id
      AND (o.created_at < now() - interval '24 hours' OR o.seq <= b.last_seq - 1000)`;
}
