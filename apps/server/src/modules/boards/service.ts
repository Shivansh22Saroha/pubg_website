import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ROOM_LIMITS,
  type Board,
  type BoardState,
  type CreateBoardBodySchema,
  type UpdateBoardBodySchema,
} from '@rotationlab/shared';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { RoomEvents } from '../rooms/events.js';
import { fromMapId, toBoard, toLayer } from '../rooms/mappers.js';
import type { RoomPolicy } from '../rooms/policy.js';
import { toElement } from '../elements/service.js';
import { defaultLayerRows, touchRoom } from '../rooms/service.js';

export interface BoardServiceDeps {
  prisma: PrismaClient;
  policy: RoomPolicy;
  events: RoomEvents;
}

/** Rewrites positions 0…n-1 in the given order. */
async function resequence(tx: Prisma.TransactionClient, ids: string[]) {
  for (const [position, id] of ids.entries()) {
    await tx.board.update({ where: { id }, data: { position } });
  }
}

export function createBoardService(d: BoardServiceDeps) {
  const { prisma, policy, events } = d;

  return {
    async list(user: AuthUser, roomId: string): Promise<Board[]> {
      await policy.requireRoom(user, roomId, 'room.view');
      const rows = await prisma.board.findMany({ where: { roomId }, orderBy: { position: 'asc' } });
      return rows.map(toBoard);
    },

    /** BOARD-1/2. `duplicateFrom` copies layers (and, from Phase 5, elements) with new ids. */
    async create(
      user: AuthUser,
      roomId: string,
      body: z.output<typeof CreateBoardBodySchema>,
    ): Promise<Board> {
      await policy.requireRoom(user, roomId, 'board.manage');
      const board = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
        const count = await tx.board.count({ where: { roomId } });
        if (count >= ROOM_LIMITS.maxBoards) {
          throw new AppError(
            'LIMIT_REACHED',
            `A room can have at most ${ROOM_LIMITS.maxBoards} boards`,
          );
        }
        const source = body.duplicateFrom
          ? await tx.board.findFirst({
              where: { id: body.duplicateFrom, roomId },
              include: { layers: { orderBy: { position: 'asc' } }, elements: true },
            })
          : null;
        if (body.duplicateFrom && !source)
          throw new AppError('NOT_FOUND', 'Board to duplicate not found');

        const id = newId();
        const created = await tx.board.create({
          data: {
            id,
            roomId,
            name: body.name,
            mapId: source?.mapId ?? fromMapId(body.mapId),
            position: count,
            createdBy: user.id,
          },
        });
        if (!source) {
          await tx.layer.createMany({ data: defaultLayerRows(id) });
          return created;
        }
        // duplicate: copy layers and elements with fresh ids (FEATURES F4)
        const layerIds = new Map(source.layers.map((l) => [l.id, newId()]));
        await tx.layer.createMany({
          data: source.layers.map((l) => ({
            id: layerIds.get(l.id) ?? newId(),
            boardId: id,
            name: l.name,
            color: l.color,
            position: l.position,
            visible: l.visible,
            locked: l.locked,
            seq: 0n,
          })),
        });
        await tx.element.createMany({
          data: source.elements.map((e) => ({
            id: newId(),
            boardId: id,
            layerId: layerIds.get(e.layerId) ?? e.layerId,
            type: e.type,
            geometry: e.geometry as Prisma.InputJsonValue,
            style: e.style as Prisma.InputJsonValue,
            props: e.props as Prisma.InputJsonValue,
            z: e.z,
            seq: 0n,
            createdBy: user.id,
            updatedBy: user.id,
          })),
        });
        return tx.board.update({ where: { id }, data: { elementCount: source.elements.length } });
      });
      const dto = toBoard(board);
      await touchRoom(prisma, roomId);
      events.emit('board:created', { roomId, board: dto });
      return dto;
    },

    /** Rename and/or move (drag & drop tab order). */
    async update(
      user: AuthUser,
      boardId: string,
      body: z.output<typeof UpdateBoardBodySchema>,
    ): Promise<Board> {
      const { board } = await policy.requireBoard(user, boardId, 'board.manage');
      const updated = await prisma.$transaction(async (tx) => {
        if (body.name !== undefined) {
          await tx.board.update({ where: { id: boardId }, data: { name: body.name } });
        }
        if (body.position !== undefined) {
          const ids = (
            await tx.board.findMany({
              where: { roomId: board.roomId },
              orderBy: { position: 'asc' },
            })
          ).map((b) => b.id);
          const from = ids.indexOf(boardId);
          ids.splice(from, 1);
          ids.splice(Math.min(body.position, ids.length), 0, boardId);
          await resequence(tx, ids);
        }
        return tx.board.findUniqueOrThrow({ where: { id: boardId } });
      });
      const dto = toBoard(updated);
      await touchRoom(prisma, board.roomId);
      events.emit('board:updated', { roomId: board.roomId, board: dto });
      return dto;
    },

    /** OWNER only; never the last board. Remaining boards are re-sequenced. */
    async remove(user: AuthUser, boardId: string): Promise<void> {
      const { board } = await policy.requireBoard(user, boardId, 'board.delete');
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${board.roomId}::uuid FOR UPDATE`;
        const remaining = await tx.board.findMany({
          where: { roomId: board.roomId },
          orderBy: { position: 'asc' },
          select: { id: true },
        });
        if (remaining.length <= 1)
          throw new AppError('CONFLICT', "A room's last board can't be deleted");
        await tx.board.delete({ where: { id: boardId } });
        await resequence(
          tx,
          remaining.map((b) => b.id).filter((id) => id !== boardId),
        );
      });
      events.emit('board:deleted', { roomId: board.roomId, boardId });
    },

    /** REST fallback of `board:subscribe` (API_SPEC §5) — used by PNG export / thumbnails. */
    async state(user: AuthUser, boardId: string): Promise<BoardState> {
      const { board } = await policy.requireBoard(user, boardId, 'room.view');
      const [layers, elements] = await Promise.all([
        prisma.layer.findMany({ where: { boardId }, orderBy: { position: 'asc' } }),
        prisma.element.findMany({ where: { boardId }, orderBy: [{ z: 'asc' }, { seq: 'asc' }] }),
      ]);
      return {
        board: toBoard(board),
        layers: layers.map(toLayer),
        elements: elements.map(toElement),
        seq: Number(board.lastSeq),
      };
    },
  };
}
export type BoardService = ReturnType<typeof createBoardService>;
