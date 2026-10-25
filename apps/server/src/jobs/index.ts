import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import cron from 'node-cron';
import { pruneBoardOps } from '../modules/elements/service.js';

const INSTANCE = randomUUID();

/**
 * Runs `fn` only on the instance that wins a Redis lock (ARCHITECTURE §11: single leader).
 * The lock expires on its own, so a crashed leader never blocks the job for long.
 */
export async function withLeaderLock(
  redis: Redis,
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const key = `rl:job:${name}`;
  const won = await redis.set(key, INSTANCE, 'PX', ttlMs, 'NX');
  if (won === null) return false;
  try {
    await fn();
  } finally {
    // release only our own lock
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      INSTANCE,
    );
  }
  return true;
}

/** Schedules the background jobs. Purge rooms / expire invites / token cleanup arrive later. */
export function startJobs(deps: { prisma: PrismaClient; redis: Redis; log: FastifyBaseLogger }) {
  const tasks = [
    cron.schedule('*/15 * * * *', () => {
      void withLeaderLock(deps.redis, 'prune-board-ops', 10 * 60_000, async () => {
        const removed = await pruneBoardOps(deps.prisma);
        deps.log.info({ removed }, 'pruned board_ops');
      }).catch((err: unknown) => {
        deps.log.error({ err }, 'prune-board-ops failed');
      });
    }),
  ];
  return () => {
    for (const t of tasks) t.stop();
  };
}
