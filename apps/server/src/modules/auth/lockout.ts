import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

export const LOCKOUT_THRESHOLD = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 3600 * 1000;

/** Lock duration after the n-th lockout: 15 min, 30, 60 … capped at 24 h (SECURITY A6). */
export function lockDurationMs(lockoutNumber: number): number {
  return Math.min(BASE_LOCK_MS * 2 ** Math.max(0, lockoutNumber - 1), MAX_LOCK_MS);
}

const key = (userId: string) => `rl:lock:${userId}`;

/**
 * Per-account lockout. Postgres (`users.failed_login_count`, `locked_until`) is the source of
 * truth; Redis mirrors the lock so the hot path can skip the DB read.
 */
export function createLockout(
  prisma: PrismaClient,
  redis: Redis,
  now: () => Date = () => new Date(),
) {
  return {
    /** locked-until date, or null */
    async lockedUntil(user: { id: string; lockedUntil: Date | null }): Promise<Date | null> {
      const at = now();
      if (user.lockedUntil && user.lockedUntil > at) return user.lockedUntil;
      const cached = await redis.get(key(user.id));
      const until = cached ? new Date(Number(cached)) : null;
      return until && until > at ? until : null;
    },

    async recordFailure(userId: string): Promise<Date | null> {
      const { failedLoginCount } = await prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (failedLoginCount % LOCKOUT_THRESHOLD !== 0) return null;
      const ms = lockDurationMs(failedLoginCount / LOCKOUT_THRESHOLD);
      const until = new Date(now().getTime() + ms);
      await prisma.user.update({ where: { id: userId }, data: { lockedUntil: until } });
      await redis.set(key(userId), String(until.getTime()), 'PX', ms);
      return until;
    },

    async recordSuccess(userId: string): Promise<void> {
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await redis.del(key(userId));
    },
  };
}
export type Lockout = ReturnType<typeof createLockout>;
