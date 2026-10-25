import type { Board, PrismaClient } from '@prisma/client';
import { can, type Permission, type RoomRole } from '@rotationlab/shared';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import type { AuthUser } from '../../lib/policy.js';

const CACHE_TTL_SEC = 30; // SECURITY Z1
const NONE = '-';
const key = (roomId: string, userId: string) => `rl:member:${roomId}:${userId}`;

/**
 * Room-scoped authorization (SECURITY §3). Resolves (user, room) → role from the DB (cached
 * 30 s in Redis, busted on every membership change) and checks it against the shared
 * permission matrix. Callers that are not members — or rooms that are deleted — get 404,
 * never 403, so room existence never leaks (Z2). REST services and (Phase 5) socket handlers
 * both go through here.
 */
export function createRoomPolicy(prisma: PrismaClient, redis: Redis) {
  async function roleOf(roomId: string, userId: string): Promise<RoomRole | null> {
    const cached = await redis.get(key(roomId, userId));
    if (cached !== null) return cached === NONE ? null : (cached as RoomRole);
    const member = await prisma.roomMember.findFirst({
      where: { roomId, userId, room: { deletedAt: null } },
      select: { role: true },
    });
    const role = member?.role ?? null;
    await redis.set(key(roomId, userId), role ?? NONE, 'EX', CACHE_TTL_SEC);
    return role;
  }

  async function requireRoom(user: AuthUser, roomId: string, permission: Permission) {
    const role = await roleOf(roomId, user.id);
    if (!role) throw new AppError('NOT_FOUND', 'Room not found');
    if (!can(role, permission)) {
      throw new AppError('FORBIDDEN', 'Your role in this room does not allow that');
    }
    return role;
  }

  return {
    roleOf,
    requireRoom,

    /** Board-scoped check: never trust a boardId without resolving its room (Z1). */
    async requireBoard(
      user: AuthUser,
      boardId: string,
      permission: Permission,
    ): Promise<{ board: Board; role: RoomRole }> {
      const board = await prisma.board.findUnique({ where: { id: boardId } });
      if (!board) throw new AppError('NOT_FOUND', 'Board not found');
      try {
        return { board, role: await requireRoom(user, board.roomId, permission) };
      } catch (err) {
        // a board in a room you can't see is "not found", not "room not found"
        if (err instanceof AppError && err.code === 'NOT_FOUND') {
          throw new AppError('NOT_FOUND', 'Board not found');
        }
        throw err;
      }
    },

    /** Drop cached roles after any membership change (role change, kick, leave, delete…). */
    async bust(roomId: string, userIds: string[]): Promise<void> {
      if (userIds.length > 0) await redis.del(...userIds.map((u) => key(roomId, u)));
    },
  };
}
export type RoomPolicy = ReturnType<typeof createRoomPolicy>;
