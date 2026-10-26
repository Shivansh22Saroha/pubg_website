import type { PrismaClient, RoomRole } from '@prisma/client';
import type { OwnedRoomChoice } from '@rotationlab/shared';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { PasswordHasher } from '../auth/passwords.js';
import type { RevocationList } from '../auth/revocation.js';
import type { RoomEvents } from '../rooms/events.js';
import type { RoomPolicy } from '../rooms/policy.js';

export interface OwnedRoom {
  id: string;
  members: { userId: string; role: RoomRole; joinedAt: Date }[];
}

export type Resolution =
  | { roomId: string; action: 'transfer'; toUserId: string; fallback: boolean }
  | { roomId: string; action: 'delete'; fallback: boolean };

/**
 * What happens to each room the user owns (AUTH-8, DATABASE_SCHEMA §6). An explicit choice
 * wins: transfer to a current member, or delete. Without one: the longest-standing editor
 * becomes owner, else the room is soft-deleted. Pure — validated here, applied by the caller.
 */
export function resolveOwnedRooms(
  meId: string,
  rooms: readonly OwnedRoom[],
  choices: readonly OwnedRoomChoice[],
): Resolution[] {
  const byRoom = new Map(rooms.map((r) => [r.id, r]));
  const chosen = new Map<string, OwnedRoomChoice>();
  for (const c of choices) {
    if (!byRoom.has(c.roomId))
      throw new AppError('VALIDATION_ERROR', 'You can only decide for rooms you own', [
        { path: 'rooms', issue: c.roomId },
      ]);
    if (chosen.has(c.roomId))
      throw new AppError('VALIDATION_ERROR', 'One choice per room', [
        { path: 'rooms', issue: c.roomId },
      ]);
    chosen.set(c.roomId, c);
  }
  return rooms.map((room): Resolution => {
    const c = chosen.get(room.id);
    if (c?.action === 'delete') return { roomId: room.id, action: 'delete', fallback: false };
    if (c?.action === 'transfer') {
      const target = room.members.find((m) => m.userId === c.toUserId);
      if (!target || target.userId === meId)
        throw new AppError('VALIDATION_ERROR', 'The new owner must be a member of that room', [
          { path: 'rooms', issue: room.id },
        ]);
      return { roomId: room.id, action: 'transfer', toUserId: target.userId, fallback: false };
    }
    const editor = room.members
      .filter((m) => m.userId !== meId && m.role === 'EDITOR')
      .sort(
        (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || (a.userId < b.userId ? -1 : 1),
      )[0];
    return editor
      ? { roomId: room.id, action: 'transfer', toUserId: editor.userId, fallback: true }
      : { roomId: room.id, action: 'delete', fallback: true };
  });
}

/** `deleted_` + the random tail of the UUIDv7 — fits the username pattern (≤ 20 chars). */
export function anonymousUsername(userId: string): string {
  return `deleted_${userId.replace(/-/g, '').slice(-12)}`;
}

export interface AccountDeps {
  prisma: PrismaClient;
  passwords: PasswordHasher;
  revocations: RevocationList;
  policy: RoomPolicy;
  events: RoomEvents;
}

/**
 * Delete account (AUTH-8) in ONE transaction: owned rooms transferred or soft-deleted, every
 * other membership left, chat kept with author = null, every refresh token revoked, the user
 * row anonymised (email → deleted+<id>@invalid, username → deleted_<short>) and marked
 * deleted, plus audit rows. After commit: revoked sessions drop their sockets, caches bust,
 * and the rooms hear about it.
 */
export function createAccountService(d: AccountDeps) {
  return {
    async deleteAccount(
      user: AuthUser,
      body: { password: string; rooms: OwnedRoomChoice[] },
    ): Promise<Resolution[]> {
      const me = await d.prisma.user.findUnique({ where: { id: user.id } });
      if (!me || me.deletedAt) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
      if (!(await d.passwords.verify(me.passwordHash, body.password)))
        throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect');

      const owned = await d.prisma.room.findMany({
        where: { ownerId: me.id, deletedAt: null },
        select: { id: true, members: { select: { userId: true, role: true, joinedAt: true } } },
      });
      const plan = resolveOwnedRooms(me.id, owned, body.rooms);
      const memberships = await d.prisma.roomMember.findMany({
        where: { userId: me.id, room: { deletedAt: null } },
        select: { roomId: true },
      });

      const families = await d.prisma.$transaction(async (tx) => {
        const now = new Date();
        for (const r of plan) {
          // lock the room so a concurrent role change can't race the transfer
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${r.roomId}::uuid FOR UPDATE`;
          if (r.action === 'transfer') {
            // one OWNER per room (DB-enforced): step down before the new owner steps up
            await tx.roomMember.delete({
              where: { roomId_userId: { roomId: r.roomId, userId: me.id } },
            });
            await tx.roomMember.update({
              where: { roomId_userId: { roomId: r.roomId, userId: r.toUserId } },
              data: { role: 'OWNER' },
            });
            await tx.room.update({ where: { id: r.roomId }, data: { ownerId: r.toUserId } });
          } else {
            await tx.room.update({ where: { id: r.roomId }, data: { deletedAt: now } });
          }
          await tx.auditLog.create({
            data: {
              id: newId(),
              actorId: me.id,
              roomId: r.roomId,
              action: r.action === 'transfer' ? 'room.transfer' : 'room.delete',
              ...(r.action === 'transfer' ? { targetId: r.toUserId } : {}),
              meta: { reason: 'account_deleted', fallback: r.fallback },
            },
          });
        }
        await tx.roomMember.deleteMany({ where: { userId: me.id } });
        await tx.chatMessage.updateMany({ where: { authorId: me.id }, data: { authorId: null } });
        const tokens = await tx.refreshToken.findMany({
          where: { userId: me.id },
          select: { familyId: true },
          distinct: ['familyId'],
        });
        await tx.refreshToken.updateMany({
          where: { userId: me.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.emailToken.deleteMany({ where: { userId: me.id } });
        await tx.user.update({
          where: { id: me.id },
          data: {
            email: `deleted+${me.id}@invalid`,
            username: anonymousUsername(me.id),
            displayName: 'Deleted user',
            ign: null,
            passwordHash: '!deleted', // not an argon2 hash: nothing can ever verify against it
            emailVerifiedAt: null,
            failedLoginCount: 0,
            lockedUntil: null,
            prefs: {},
            deletedAt: now,
          },
        });
        await tx.auditLog.create({
          data: { id: newId(), actorId: me.id, action: 'account.delete', targetId: me.id },
        });
        return tokens.map((t) => t.familyId);
      });

      // after commit: kill every session (and its sockets), bust caches, tell the rooms
      await d.revocations.revoke([...new Set([...families, user.sid])]);
      const transferred = new Set(plan.map((r) => r.roomId));
      for (const r of plan) {
        if (r.action === 'transfer') {
          await d.policy.bust(r.roomId, [me.id, r.toUserId]);
          d.events.emit('member:roleChanged', {
            roomId: r.roomId,
            userId: r.toUserId,
            role: 'OWNER',
          });
          d.events.emit('member:left', { roomId: r.roomId, userId: me.id });
        } else {
          await d.policy.bust(r.roomId, [me.id]);
          d.events.emit('room:deleted', { roomId: r.roomId });
        }
      }
      for (const m of memberships) {
        if (transferred.has(m.roomId)) continue;
        await d.policy.bust(m.roomId, [me.id]);
        d.events.emit('member:left', { roomId: m.roomId, userId: me.id });
      }
      return plan;
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
