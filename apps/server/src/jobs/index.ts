import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import cron from 'node-cron';
import { pruneBoardOps } from '../modules/elements/service.js';
import {
  cleanupTokens,
  expireInvites,
  expireShareLinks,
  purgeDeletedRooms,
} from './maintenance.js';

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

/** Schedules the background jobs (ARCHITECTURE §11), each on one leader instance at a time. */
export function startJobs(deps: { prisma: PrismaClient; redis: Redis; log: FastifyBaseLogger }) {
  const job = (name: string, schedule: string, run: () => Promise<unknown>) =>
    cron.schedule(schedule, () => {
      void withLeaderLock(deps.redis, name, 10 * 60_000, async () => {
        deps.log.info({ job: name, result: await run() }, 'job done');
      }).catch((err: unknown) => {
        deps.log.error({ err, job: name }, 'job failed');
      });
    });
  const tasks = [
    job('prune-board-ops', '*/15 * * * *', () => pruneBoardOps(deps.prisma)),
    job('purge-deleted-rooms', '7 * * * *', () => purgeDeletedRooms(deps.prisma)),
    job('expire-invites', '17 * * * *', () => expireInvites(deps.prisma)),
    job('expire-share-links', '19 * * * *', () => expireShareLinks(deps.prisma)),
    job('cleanup-tokens', '27 3 * * *', () => cleanupTokens(deps.prisma)),
  ];
  return () => {
    for (const t of tasks) t.stop();
  };
}
