import { Prisma, type ChatMessage as ChatRow, type PrismaClient, type User } from '@prisma/client';
import {
  can,
  DELETED_BODY,
  MAPS,
  pingWithinWorld,
  type ChatMessage,
  type PingInput,
} from '@rotationlab/shared';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { RoomEvents } from '../rooms/events.js';
import { toMapId, toPublicUser } from '../rooms/mappers.js';
import type { RoomPolicy } from '../rooms/policy.js';

export interface ChatDeps {
  prisma: PrismaClient;
  policy: RoomPolicy;
  events: RoomEvents;
}

type Row = ChatRow & { author: User | null };

export function toChatMessage(row: Row): ChatMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    author: row.author ? toPublicUser(row.author) : null,
    kind: row.kind,
    body: row.body,
    ping:
      row.pingX !== null && row.pingY !== null
        ? { boardId: row.pingBoardId, x: row.pingX, y: row.pingY }
        : null,
    deleted: row.deletedAt !== null,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
  };
}

const withAuthor = { author: true } as const;

/**
 * Room chat & map pings (FEATURES F9, API_SPEC §6–7). Bodies arrive already cleaned by the
 * shared schema (NFC, control characters stripped except \n, 1–500 code points) and are
 * stored and returned verbatim — the client renders them as text nodes only (SECURITY V4).
 * Bodies never reach the logs: nothing here logs them, and handlers log errors only.
 */
export function createChatService({ prisma, policy, events }: ChatDeps) {
  async function validPing(roomId: string, ping: PingInput) {
    const board = await prisma.board.findUnique({
      where: { id: ping.boardId },
      select: { roomId: true, mapId: true },
    });
    // a board of another room is indistinguishable from a missing one (Z2)
    if (!board || board.roomId !== roomId)
      throw new AppError('VALIDATION_ERROR', 'The ping’s board is not in this room');
    if (!pingWithinWorld(ping, MAPS[toMapId(board.mapId)].worldSize))
      throw new AppError('VALIDATION_ERROR', 'The ping is outside the map');
  }

  return {
    /**
     * `chat:send`. Idempotent per (author, clientId): a resend returns the stored message and
     * `replay: true` (nothing is broadcast again).
     */
    async send(
      user: AuthUser,
      input: { clientId: string; roomId: string; body: string; ping?: PingInput | undefined },
    ): Promise<{ message: ChatMessage; replay: boolean }> {
      await policy.requireRoom(user, input.roomId, 'room.interact');
      const key = { authorId_clientId: { authorId: user.id, clientId: input.clientId } };
      const prior = await prisma.chatMessage.findUnique({ where: key, include: withAuthor });
      if (prior) {
        if (prior.roomId !== input.roomId)
          throw new AppError('CONFLICT', 'That clientId was already used in another room');
        return { message: toChatMessage(prior), replay: true };
      }
      if (input.ping) await validPing(input.roomId, input.ping);
      let row: Row;
      try {
        row = await prisma.chatMessage.create({
          data: {
            id: newId(),
            roomId: input.roomId,
            authorId: user.id,
            kind: 'USER',
            body: input.body,
            clientId: input.clientId,
            ...(input.ping
              ? { pingBoardId: input.ping.boardId, pingX: input.ping.x, pingY: input.ping.y }
              : {}),
          },
          include: withAuthor,
        });
      } catch (err) {
        // two sockets resending the same clientId at once: the loser replays the winner
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await prisma.chatMessage.findUnique({ where: key, include: withAuthor });
          if (winner) return { message: toChatMessage(winner), replay: true };
        }
        throw err;
      }
      const message = toChatMessage(row);
      await prisma.room.update({
        where: { id: input.roomId },
        data: { lastActivityAt: row.createdAt },
      });
      events.emit('chat:message', { roomId: input.roomId, message });
      return { message, replay: false };
    },

    /** Newest first; `before` is the last id of the previous page (UUIDv7 → time order). */
    async list(
      user: AuthUser,
      roomId: string,
      { limit, before }: { limit: number; before?: string | undefined },
    ): Promise<{ items: ChatMessage[]; nextCursor: string | null }> {
      await policy.requireRoom(user, roomId, 'room.view');
      const rows = await prisma.chatMessage.findMany({
        where: { roomId, ...(before ? { id: { lt: before } } : {}) },
        orderBy: { id: 'desc' },
        take: limit + 1,
        include: withAuthor,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map(toChatMessage),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },

    /** Author or OWNER. The body is overwritten (not kept) and the ping dropped. Idempotent. */
    async remove(user: AuthUser, messageId: string): Promise<void> {
      const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      const role = row ? await policy.roleOf(row.roomId, user.id) : null;
      if (!row || !role) throw new AppError('NOT_FOUND', 'Message not found');
      if (row.authorId !== user.id && !can(role, 'chat.deleteAny'))
        throw new AppError('FORBIDDEN', 'Only the author or the room owner can delete this');
      if (row.deletedAt) return;
      await prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          body: DELETED_BODY,
          deletedAt: new Date(),
          pingBoardId: null,
          pingX: null,
          pingY: null,
        },
      });
      events.emit('chat:deleted', { roomId: row.roomId, messageId });
    },

    /** A SYSTEM message (join, leave, kick, role change, boards…), broadcast like any other. */
    async system(roomId: string, body: string): Promise<ChatMessage> {
      const row = await prisma.chatMessage.create({
        data: { id: newId(), roomId, kind: 'SYSTEM', body: body.slice(0, 500) },
        include: withAuthor,
      });
      const message = toChatMessage(row);
      events.emit('chat:message', { roomId, message });
      return message;
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
