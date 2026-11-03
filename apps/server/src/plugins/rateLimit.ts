import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { AppError } from '../lib/errors.js';

/** SECURITY §6 limits used by Phase 3 routes. */
export const LIMITS = {
  global: { max: 300, timeWindow: '1 minute' },
  login: { max: 10, timeWindow: '1 minute' },
  register: { max: 10, timeWindow: '1 minute' },
  registerHourly: { max: 5, windowSec: 3600 },
  usernameAvailable: { max: 20, timeWindow: '1 minute' },
  invitePreview: { max: 30, timeWindow: '1 minute' },
  /** FEATURES F13: `/explore`'s demo boards, per IP */
  demoBoards: { max: 30, timeWindow: '1 minute' },
  /** Phase 11: a public share link's board, per IP */
  sharedBoard: { max: 30, timeWindow: '1 minute' },
  roomCreateDaily: { max: 10, windowSec: 86_400 },
  inviteAcceptHourly: { max: 20, windowSec: 3600 },
  /** SECURITY §6: forgot-password 3 / hour / email + 10 / hour / IP */
  forgotEmailHourly: { max: 3, windowSec: 3600 },
  forgotIpHourly: { max: 10, windowSec: 3600 },
  verifyResendHourly: { max: 3, windowSec: 3600 },
  /** verify / reset token submissions */
  emailToken: { max: 10, timeWindow: '1 minute' },
} as const;

/** Keys a fixed window by the authenticated user (falls back to IP). */
export const byUser = (req: FastifyRequest) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`);

/**
 * Per-IP limits backed by Redis so they hold across server instances. When disabled
 * (RATE_LIMITS_ENABLED=false, never in production) route-level `config.rateLimit` is ignored.
 */
export async function registerRateLimit(app: FastifyInstance, redis: Redis, enabled: boolean) {
  if (!enabled) return;
  await app.register(rateLimit, {
    global: true,
    ...LIMITS.global,
    redis,
    nameSpace: 'rl:rate:',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${ctx.after}`,
    }),
  });
}

/**
 * A second, longer fixed window on top of the plugin's (e.g. register: 10/min AND 5/hour).
 * Use as a route preHandler.
 */
export function fixedWindowLimit(
  redis: Redis,
  enabled: boolean,
  name: string,
  { max, windowSec }: { max: number; windowSec: number },
  keyOf: (request: FastifyRequest) => string = (request) => request.ip,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!enabled) return;
    const key = `rl:rate:${name}:${keyOf(request)}`;
    const [[, count], [, ttl]] = (await redis.multi().incr(key).ttl(key).exec()) as [
      [null, number],
      [null, number],
    ];
    if (ttl < 0) await redis.expire(key, windowSec);
    if (count > max) {
      reply.header('retry-after', String(ttl > 0 ? ttl : windowSec));
      throw new AppError('RATE_LIMITED', 'Too many requests');
    }
  };
}
