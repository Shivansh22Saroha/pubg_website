import type { MapId as MapIdRow, Prisma, PrismaClient, Room } from '@prisma/client';
import {
  DEFAULT_LAYERS,
  type AssignableRole,
  type Board,
  type CreateRoomBodySchema,
  type Member,
  type RoomDetail,
  type RoomBan,
  type RoomDetailResponse,
  type RoomSummary,
  type UpdateRoomBodySchema,
} from '@rotationlab/shared';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { PasswordHasher } from '../auth/passwords.js';
import type { RoomEvents } from './events.js';
import { fromMapId, toBoard, toMapId, toMember, toPublicUser } from './mappers.js';
import type { RoomPolicy } from './policy.js';

export interface RoomServiceDeps {
  prisma: PrismaClient;
  policy: RoomPolicy;
  events: RoomEvents;
  passwords: PasswordHasher;
  limits: { maxOwnedRooms: number; maxRoomMembers: number };
}

type RoomWithCounts = Room & {
  _count: { members: number; boards: number };
  boards: { mapId: MapIdRow }[];
};
const withCounts = {
  _count: { select: { members: true, boards: true } },
  // most recently updated board → dashboard card preview (primaryMapId)
  boards: { select: { mapId: true }, orderBy: { updatedAt: 'desc' }, take: 1 },
} as const;

const assignable = (role: Room['defaultRole']): AssignableRole =>
  role === 'VIEWER' ? 'VIEWER' : 'EDITOR';

function summary(room: RoomWithCounts, role: RoomSummary['role']): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    role,
    memberCount: room._count.members,
    onlineCount: 0, // presence arrives with the realtime core (Phase 5)
    boardCount: room._count.boards,
    lastActivityAt: room.lastActivityAt.toISOString(),
    thumbnailUrl: null, // board thumbnails are P1
    hasPassword: room.passwordHash !== null,
    primaryMapId: toMapId(room.boards[0]?.mapId ?? 'ERANGEL'),
  };
}

function detail(room: RoomWithCounts, role: RoomSummary['role']): RoomDetail {
  return {
    ...summary(room, role),
    ownerId: room.ownerId,
    isLocked: room.isLocked,
    defaultRole: assignable(room.defaultRole),
    maxMembers: room.maxMembers,
  };
}

/** Default layers for a fresh board (FEATURES F2). */
export function defaultLayerRows(boardId: string): Prisma.LayerCreateManyInput[] {
  return DEFAULT_LAYERS.map((l, position) => ({
    id: newId(),
    boardId,
    name: l.name,
    color: l.color,
    position,
    seq: 0n,
  }));
}

/** Debounced (≤ 1/min) lastActivityAt bump (FEATURES F2). */
export async function touchRoom(prisma: PrismaClient, roomId: string): Promise<void> {
  const now = new Date();
  await prisma.room.updateMany({
    where: { id: roomId, lastActivityAt: { lt: new Date(now.getTime() - 60_000) } },
    data: { lastActivityAt: now },
  });
}

export function createRoomService(d: RoomServiceDeps) {
  const { prisma, policy, events } = d;

  async function loadRoom(roomId: string): Promise<RoomWithCounts> {
    const room = await prisma.room.findFirst({
      where: { id: roomId, deletedAt: null },
      include: withCounts,
    });
    if (!room) throw new AppError('NOT_FOUND', 'Room not found');
    return room;
  }

  async function members(roomId: string): Promise<Member[]> {
    const rows = await prisma.roomMember.findMany({
      where: { roomId },
      include: { user: true },
      orderBy: [{ joinedAt: 'asc' }],
    });
    return rows.map((m) => toMember(m));
  }

  async function requireTarget(roomId: string, userId: string) {
    const target = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!target) throw new AppError('NOT_FOUND', 'Member not found');
    return target;
  }

  return {
    async list(userId: string): Promise<RoomSummary[]> {
      const rows = await prisma.roomMember.findMany({
        where: { userId, room: { deletedAt: null } },
        include: { room: { include: withCounts } },
        orderBy: { room: { lastActivityAt: 'desc' } },
      });
      return rows.map((m) => summary(m.room, m.role));
    },

    /** ROOM-1/2: room + OWNER membership + first board + 3 default layers in one transaction. */
    async create(
      user: AuthUser,
      body: z.output<typeof CreateRoomBodySchema>,
    ): Promise<{ room: RoomSummary; board: Board }> {
      const owned = await prisma.room.count({ where: { ownerId: user.id, deletedAt: null } });
      if (owned >= d.limits.maxOwnedRooms) {
        throw new AppError('LIMIT_REACHED', `You can own at most ${d.limits.maxOwnedRooms} rooms`);
      }
      const passwordHash = body.password ? await d.passwords.hash(body.password) : null;
      const roomId = newId();
      const boardId = newId();
      const { room, board } = await prisma.$transaction(async (tx) => {
        await tx.room.create({
          data: {
            id: roomId,
            name: body.name,
            description: body.description || null,
            ownerId: user.id,
            passwordHash,
            defaultRole: body.defaultRole ?? 'EDITOR',
            maxMembers: d.limits.maxRoomMembers,
          },
        });
        await tx.roomMember.create({ data: { roomId, userId: user.id, role: 'OWNER' } });
        const board = await tx.board.create({
          data: {
            id: boardId,
            roomId,
            name: body.firstBoard.name,
            mapId: fromMapId(body.firstBoard.mapId),
            position: 0,
            createdBy: user.id,
          },
        });
        await tx.layer.createMany({ data: defaultLayerRows(boardId) });
        const room = await tx.room.findUniqueOrThrow({
          where: { id: roomId },
          include: withCounts,
        });
        return { room, board };
      });
      await policy.bust(roomId, [user.id]);
      return { room: summary(room, 'OWNER'), board: toBoard(board) };
    },

    async detail(user: AuthUser, roomId: string): Promise<RoomDetailResponse> {
      const role = await policy.requireRoom(user, roomId, 'room.view');
      const room = await loadRoom(roomId);
      const boards = await prisma.board.findMany({
        where: { roomId },
        orderBy: { position: 'asc' },
      });
      return {
        room: detail(room, role),
        members: await members(roomId),
        boards: boards.map(toBoard),
      };
    },

    async members(user: AuthUser, roomId: string): Promise<Member[]> {
      await policy.requireRoom(user, roomId, 'room.view');
      return members(roomId);
    },

    async update(user: AuthUser, roomId: string, body: z.output<typeof UpdateRoomBodySchema>) {
      const role = await policy.requireRoom(user, roomId, 'room.manage');
      await prisma.room.update({
        where: { id: roomId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          ...(body.defaultRole !== undefined ? { defaultRole: body.defaultRole } : {}),
          ...(body.isLocked !== undefined ? { isLocked: body.isLocked } : {}),
        },
      });
      const room = detail(await loadRoom(roomId), role);
      events.emit('room:updated', { roomId, room });
      return room;
    },

    async setPassword(user: AuthUser, roomId: string, password: string | null): Promise<void> {
      await policy.requireRoom(user, roomId, 'room.manage');
      await prisma.room.update({
        where: { id: roomId },
        data: { passwordHash: password ? await d.passwords.hash(password) : null },
      });
    },

    /** ROOM-7: soft delete (purged after 7 days by a Phase 10 job). Requires typing the name. */
    async remove(user: AuthUser, roomId: string, confirmName: string): Promise<void> {
      await policy.requireRoom(user, roomId, 'room.manage');
      const room = await loadRoom(roomId);
      if (confirmName.trim() !== room.name) {
        throw new AppError('VALIDATION_ERROR', 'Type the room name exactly to confirm', [
          { path: 'confirmName', issue: 'mismatch' },
        ]);
      }
      await prisma.room.update({ where: { id: roomId }, data: { deletedAt: new Date() } });
      const ids = await prisma.roomMember.findMany({ where: { roomId }, select: { userId: true } });
      await policy.bust(
        roomId,
        ids.map((m) => m.userId),
      );
      events.emit('room:deleted', { roomId });
    },

    /** ROOM-5: any member except the owner (who must transfer or delete first). */
    async leave(user: AuthUser, roomId: string): Promise<void> {
      const role = await policy.requireRoom(user, roomId, 'room.view');
      if (role === 'OWNER') {
        throw new AppError('FORBIDDEN', 'Transfer ownership or delete the room before leaving');
      }
      await prisma.roomMember.delete({ where: { roomId_userId: { roomId, userId: user.id } } });
      await policy.bust(roomId, [user.id]);
      events.emit('member:left', { roomId, userId: user.id });
    },

    /** ROOM-2: owner hands over; requires the owner's account password. */
    async transfer(user: AuthUser, roomId: string, targetId: string, password: string) {
      await policy.requireRoom(user, roomId, 'room.manage');
      const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await d.passwords.verify(me.passwordHash, password))) {
        throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect');
      }
      if (targetId === user.id) throw new AppError('BAD_REQUEST', 'You already own this room');
      await requireTarget(roomId, targetId);
      await prisma.$transaction(async (tx) => {
        // demote first: the partial unique index allows only one OWNER row per room
        await tx.roomMember.update({
          where: { roomId_userId: { roomId, userId: user.id } },
          data: { role: 'EDITOR' },
        });
        await tx.roomMember.update({
          where: { roomId_userId: { roomId, userId: targetId } },
          data: { role: 'OWNER' },
        });
        await tx.room.update({ where: { id: roomId }, data: { ownerId: targetId } });
      });
      await policy.bust(roomId, [user.id, targetId]);
      events.emit('member:roleChanged', { roomId, userId: user.id, role: 'EDITOR' });
      events.emit('member:roleChanged', { roomId, userId: targetId, role: 'OWNER' });
    },

    async setMemberRole(user: AuthUser, roomId: string, targetId: string, role: AssignableRole) {
      await policy.requireRoom(user, roomId, 'room.manage');
      const target = await requireTarget(roomId, targetId);
      if (target.role === 'OWNER') {
        throw new AppError(
          'FORBIDDEN',
          "The owner's role can only change by transferring ownership",
        );
      }
      const updated = await prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId: targetId } },
        data: { role },
        include: { user: true },
      });
      await policy.bust(roomId, [targetId]);
      events.emit('member:roleChanged', { roomId, userId: targetId, role });
      return toMember(updated);
    },

    /**
     * ROOM-5: kick; `ban` also blocks rejoining through any invite. Realtime force-disconnects
     * the target's sockets on `member:kicked` (SECURITY Z5).
     */
    async kick(user: AuthUser, roomId: string, targetId: string, ban = false): Promise<void> {
      await policy.requireRoom(user, roomId, 'room.manage');
      const target = await requireTarget(roomId, targetId);
      if (target.role === 'OWNER') throw new AppError('FORBIDDEN', 'The owner cannot be removed');
      await prisma.$transaction(async (tx) => {
        await tx.roomMember.delete({ where: { roomId_userId: { roomId, userId: targetId } } });
        if (ban) {
          await tx.roomBan.upsert({
            where: { roomId_userId: { roomId, userId: targetId } },
            create: { roomId, userId: targetId, bannedBy: user.id },
            update: {},
          });
        }
      });
      await policy.bust(roomId, [targetId]);
      events.emit('member:kicked', { roomId, userId: targetId });
    },

    async bans(user: AuthUser, roomId: string): Promise<RoomBan[]> {
      await policy.requireRoom(user, roomId, 'room.manage');
      const rows = await prisma.roomBan.findMany({
        where: { roomId },
        include: { user: true, issuer: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((b) => ({
        user: toPublicUser(b.user),
        bannedBy: b.issuer ? toPublicUser(b.issuer) : null,
        createdAt: b.createdAt.toISOString(),
      }));
    },

    async unban(user: AuthUser, roomId: string, targetId: string): Promise<void> {
      await policy.requireRoom(user, roomId, 'room.manage');
      const { count } = await prisma.roomBan.deleteMany({ where: { roomId, userId: targetId } });
      if (count === 0) throw new AppError('NOT_FOUND', 'Ban not found');
    },
  };
}
export type RoomService = ReturnType<typeof createRoomService>;
