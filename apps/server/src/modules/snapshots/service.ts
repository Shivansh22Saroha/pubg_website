import { Prisma, type PrismaClient } from '@prisma/client';
import {
  can,
  parseSnapshotData,
  SNAPSHOT_LIMITS,
  type Snapshot,
  type SnapshotData,
} from '@rotationlab/shared';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { RoomEvents } from '../rooms/events.js';
import type { RoomPolicy } from '../rooms/policy.js';
import { touchRoom } from '../rooms/service.js';
import { autoName, captureSnapshot, toSnapshot } from './capture.js';

export interface SnapshotDeps {
  prisma: PrismaClient;
  policy: RoomPolicy;
  events: RoomEvents;
}

const withAuthor = { author: true } as const;

/**
 * Snapshots (FEATURES F10, API_SPEC §5). Saving and restoring need `board.manage`
 * (OWNER / EDITOR); viewing needs membership; deleting is for the owner or the author.
 */
export function createSnapshotService({ prisma, policy, events }: SnapshotDeps) {
  async function load(user: AuthUser, snapshotId: string) {
    const row = await prisma.snapshot.findUnique({
      where: { id: snapshotId },
      include: withAuthor,
    });
    if (!row) throw new AppError('NOT_FOUND', 'Snapshot not found');
    try {
      const access = await policy.requireBoard(user, row.boardId, 'room.view');
      return { row, ...access };
    } catch (err) {
      // a snapshot of a board you can't see doesn't exist for you (Z2)
      if (err instanceof AppError && err.code === 'NOT_FOUND')
        throw new AppError('NOT_FOUND', 'Snapshot not found');
      throw err;
    }
  }

  return {
    async list(user: AuthUser, boardId: string): Promise<Snapshot[]> {
      await policy.requireBoard(user, boardId, 'room.view');
      const rows = await prisma.snapshot.findMany({
        where: { boardId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: withAuthor,
      });
      return rows.map(toSnapshot);
    },

    async create(user: AuthUser, boardId: string, name: string): Promise<Snapshot> {
      const { board } = await policy.requireBoard(user, boardId, 'board.manage');
      const row = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
        const manual = await tx.snapshot.count({ where: { boardId, isAuto: false } });
        if (manual >= SNAPSHOT_LIMITS.manualPerBoard) {
          throw new AppError(
            'LIMIT_REACHED',
            `A board keeps at most ${SNAPSHOT_LIMITS.manualPerBoard} snapshots — delete an old one first`,
          );
        }
        const created = await captureSnapshot(tx, {
          boardId,
          name,
          isAuto: false,
          createdBy: user.id,
        });
        return tx.snapshot.findUniqueOrThrow({ where: { id: created.id }, include: withAuthor });
      });
      events.emit('snapshot:saved', { roomId: board.roomId, boardId, userId: user.id, name });
      return toSnapshot(row);
    },

    async get(
      user: AuthUser,
      snapshotId: string,
    ): Promise<{ snapshot: Snapshot; data: SnapshotData }> {
      const { row } = await load(user, snapshotId);
      return { snapshot: toSnapshot(row), data: parseSnapshotData(row.data) };
    },

    /**
     * UF-11 / DATABASE_SCHEMA §6, in ONE transaction: auto-snapshot the current state →
     * replace layers + elements with the snapshot's (ids kept, new seq) → drop the op log so
     * no client can delta-resync across the reset → bump last_seq, fix element_count → audit.
     * Only after commit: `board:reset` and the system message.
     */
    async restore(user: AuthUser, snapshotId: string): Promise<{ seq: number }> {
      const { row, board } = await load(user, snapshotId);
      await policy.requireBoard(user, row.boardId, 'board.manage');
      const data = parseSnapshotData(row.data);
      const boardId = row.boardId;
      const seq = await prisma.$transaction(
        async (tx) => {
          const [locked] = await tx.$queryRaw<{ last_seq: bigint }[]>`
            SELECT last_seq FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
          if (!locked) throw new AppError('NOT_FOUND', 'Board not found');
          const auto = await captureSnapshot(tx, {
            boardId,
            name: autoName('Before restore of ', row.name),
            isAuto: true,
            createdBy: user.id,
            keep: row.id,
          });
          const next = locked.last_seq + 1n;
          await tx.boardOp.deleteMany({ where: { boardId } });
          await tx.layer.deleteMany({ where: { boardId } }); // cascades their elements
          await tx.layer.createMany({
            data: data.layers.map((l) => ({ ...l, boardId, seq: next })),
          });
          if (data.elements.length > 0) {
            await tx.element.createMany({
              data: data.elements.map((e) => ({
                id: e.id,
                boardId,
                layerId: e.layerId,
                type: e.type,
                geometry: e.geometry as Prisma.InputJsonValue,
                style: e.style,
                props: e.props as Prisma.InputJsonValue,
                z: e.z,
                seq: next,
                createdBy: e.createdBy,
                updatedBy: user.id,
              })),
            });
          }
          await tx.board.update({
            where: { id: boardId },
            data: { lastSeq: next, elementCount: data.elements.length },
          });
          await tx.auditLog.create({
            data: {
              id: newId(),
              actorId: user.id,
              roomId: board.roomId,
              action: 'snapshot.restore',
              targetId: row.id,
              meta: { boardId, name: row.name, autoSnapshotId: auto.id },
            },
          });
          return Number(next);
        },
        { timeout: 30_000 },
      );
      await touchRoom(prisma, board.roomId);
      events.emit('board:reset', {
        roomId: board.roomId,
        boardId,
        seq,
        reason: 'snapshot_restore',
        actorId: user.id,
      });
      events.emit('snapshot:restored', {
        roomId: board.roomId,
        boardId,
        userId: user.id,
        name: row.name,
      });
      return { seq };
    },

    async remove(user: AuthUser, snapshotId: string): Promise<void> {
      const { row, role } = await load(user, snapshotId);
      if (row.createdBy !== user.id && !can(role, 'room.manage'))
        throw new AppError('FORBIDDEN', 'Only the room owner or the author can delete a snapshot');
      await prisma.snapshot.delete({ where: { id: snapshotId } }).catch((err: unknown) => {
        // deleted meanwhile (or pruned): fine
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'))
          throw err;
      });
    },
  };
}

export type SnapshotService = ReturnType<typeof createSnapshotService>;
