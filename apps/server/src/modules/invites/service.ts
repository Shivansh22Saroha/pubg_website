import { randomInt } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  minRole,
  roleAtLeast,
  type CreateInviteBodySchema,
  type Invite,
  type InvitePreview,
  type RoomRole,
} from '@rotationlab/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { PasswordHasher } from '../auth/passwords.js';
import type { RoomEvents } from '../rooms/events.js';
import { toInvite, toMapId, toMember } from '../rooms/mappers.js';
import type { RoomPolicy } from '../rooms/policy.js';
import { touchRoom } from '../rooms/service.js';

/** 10 chars of Crockford base32 from a CSPRNG ≈ 50 bits (SECURITY Z7). */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++)
    code += INVITE_ALPHABET.charAt(randomInt(INVITE_ALPHABET.length));
  return code;
}

const EXPIRY_MS = { '1h': 3600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, never: null } as const;

const WRONG_PASSWORD_LIMIT = { max: 5, windowSec: 600 }; // SECURITY Z6: per user+room

interface InviteState {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
}
export function inviteUsable(i: InviteState, now = new Date()): boolean {
  if (i.revokedAt) return false;
  if (i.expiresAt && i.expiresAt <= now) return false;
  return i.maxUses === null || i.useCount < i.maxUses;
}

export interface InviteServiceDeps {
  prisma: PrismaClient;
  redis: Redis;
  policy: RoomPolicy;
  events: RoomEvents;
  passwords: PasswordHasher;
  appOrigin: string;
}

export function createInviteService(d: InviteServiceDeps) {
  const { prisma, policy } = d;

  return {
    /** Active invites of a room (OWNER, EDITOR). */
    async list(user: AuthUser, roomId: string): Promise<Invite[]> {
      await policy.requireRoom(user, roomId, 'invite.create');
      const rows = await prisma.roomInvite.findMany({
        where: { roomId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return rows.filter((i) => inviteUsable(i)).map((i) => toInvite(i, d.appOrigin));
    },

    /** ROOM-3. Editors may only hand out roles ≤ their own. */
    async create(
      user: AuthUser,
      roomId: string,
      body: z.output<typeof CreateInviteBodySchema>,
    ): Promise<Invite> {
      const myRole = await policy.requireRoom(user, roomId, 'invite.create');
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      const role = body.role ?? (room.defaultRole === 'VIEWER' ? 'VIEWER' : 'EDITOR');
      if (!roleAtLeast(myRole, role)) {
        throw new AppError('FORBIDDEN', 'You can only invite with a role up to your own');
      }
      const ms = EXPIRY_MS[body.expiresIn];
      const expiresAt = ms === null ? null : new Date(Date.now() + ms);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const invite = await prisma.roomInvite.create({
            data: {
              id: newId(),
              roomId,
              code: generateInviteCode(),
              createdBy: user.id,
              role,
              maxUses: body.maxUses ?? null,
              expiresAt,
            },
          });
          return toInvite(invite, d.appOrigin);
        } catch (err) {
          const collision =
            err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
          if (!collision) throw err;
        }
      }
      throw new AppError('INTERNAL', 'Could not allocate an invite code');
    },

    /** Owner, or the invite's creator. */
    async revoke(user: AuthUser, roomId: string, inviteId: string): Promise<void> {
      const role = await policy.requireRoom(user, roomId, 'room.view');
      const invite = await prisma.roomInvite.findFirst({ where: { id: inviteId, roomId } });
      if (!invite) throw new AppError('NOT_FOUND', 'Invite not found');
      if (role !== 'OWNER' && invite.createdBy !== user.id) {
        throw new AppError('FORBIDDEN', 'Only the owner or the creator can revoke this invite');
      }
      await prisma.roomInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    },

    /** Public preview for /join/[code]. Unknown codes and deleted rooms → 404. */
    async preview(code: string): Promise<InvitePreview> {
      const invite = await prisma.roomInvite.findUnique({
        where: { code },
        include: {
          room: {
            include: {
              owner: { select: { displayName: true } },
              boards: { select: { mapId: true }, orderBy: { position: 'asc' } },
              _count: { select: { members: true } },
            },
          },
        },
      });
      if (!invite || invite.room.deletedAt) throw new AppError('NOT_FOUND', 'Invite not found');
      const { room } = invite;
      return {
        room: {
          name: room.name,
          memberCount: room._count.members,
          ownerName: room.owner.displayName,
          hasPassword: room.passwordHash !== null,
          maps: [...new Set(room.boards.map((b) => toMapId(b.mapId)))],
        },
        valid: inviteUsable(invite),
      };
    },

    /**
     * ROOM-4. Already a member → 409 ALREADY_MEMBER carrying the roomId (client goes straight
     * in). Use count and member limit are enforced under row locks so concurrent accepts can't
     * exceed max_uses or max_members.
     */
    async accept(user: AuthUser, code: string, password: string | undefined): Promise<string> {
      const invite = await prisma.roomInvite.findUnique({
        where: { code },
        include: { room: true },
      });
      if (!invite || invite.room.deletedAt) throw new AppError('NOT_FOUND', 'Invite not found');
      const { room } = invite;
      const alreadyMember = (roomId: string) =>
        new AppError('ALREADY_MEMBER', 'You are already a member of this room', [
          { path: 'roomId', issue: roomId },
        ]);

      if (await policy.roleOf(room.id, user.id)) throw alreadyMember(room.id);
      if (!inviteUsable(invite))
        throw new AppError('INVITE_EXPIRED', 'This invite is no longer valid');
      if (room.isLocked) throw new AppError('ROOM_LOCKED', "This room isn't accepting new members");

      if (room.passwordHash) {
        const key = `rl:rate:room-password:${room.id}:${user.id}`;
        const failures = Number((await d.redis.get(key)) ?? 0);
        if (failures >= WRONG_PASSWORD_LIMIT.max) {
          throw new AppError('RATE_LIMITED', 'Too many wrong passwords. Try again later.');
        }
        if (!password || !(await d.passwords.verify(room.passwordHash, password))) {
          await d.redis.multi().incr(key).expire(key, WRONG_PASSWORD_LIMIT.windowSec, 'NX').exec();
          throw new AppError('WRONG_ROOM_PASSWORD', 'Wrong room password');
        }
      }

      const member = await prisma.$transaction(async (tx) => {
        // lock order: room, then invite — both rows serialise concurrent accepts
        await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${room.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM room_invites WHERE id = ${invite.id}::uuid FOR UPDATE`;
        const fresh = await tx.roomInvite.findUniqueOrThrow({ where: { id: invite.id } });
        const freshRoom = await tx.room.findUniqueOrThrow({ where: { id: room.id } });
        const existing = await tx.roomMember.findUnique({
          where: { roomId_userId: { roomId: room.id, userId: user.id } },
        });
        if (existing) throw alreadyMember(room.id);
        if (!inviteUsable(fresh) || freshRoom.deletedAt) {
          throw new AppError('INVITE_EXPIRED', 'This invite is no longer valid');
        }
        if (freshRoom.isLocked)
          throw new AppError('ROOM_LOCKED', "This room isn't accepting new members");
        const count = await tx.roomMember.count({ where: { roomId: room.id } });
        if (count >= freshRoom.maxMembers) {
          throw new AppError('LIMIT_REACHED', `Room is full (${count}/${freshRoom.maxMembers})`);
        }

        // FEATURES F2: an invite is capped at its creator's *current* role; a creator who has
        // left the room no longer vouches for more than VIEWER.
        let role: RoomRole = fresh.role;
        const creator = fresh.createdBy
          ? await tx.roomMember.findUnique({
              where: { roomId_userId: { roomId: room.id, userId: fresh.createdBy } },
            })
          : null;
        role = minRole(role, creator?.role ?? 'VIEWER');
        if (role === 'OWNER') role = 'EDITOR';

        await tx.roomInvite.update({
          where: { id: fresh.id },
          data: { useCount: { increment: 1 } },
        });
        return tx.roomMember.create({
          data: { roomId: room.id, userId: user.id, role },
          include: { user: true },
        });
      });

      await policy.bust(room.id, [user.id]);
      await touchRoom(prisma, room.id);
      d.events.emit('member:joined', { roomId: room.id, member: toMember(member) });
      return room.id;
    },
  };
}
export type InviteService = ReturnType<typeof createInviteService>;
