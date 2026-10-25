import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';
import { registerPolicy } from './lib/policy.js';
import { createAuthCookies } from './modules/auth/cookies.js';
import { createLockout } from './modules/auth/lockout.js';
import { createPasswordHasher } from './modules/auth/passwords.js';
import { createRevocationList } from './modules/auth/revocation.js';
import { authRoutes } from './modules/auth/routes.js';
import { createAuthService } from './modules/auth/service.js';
import { createPrismaRefreshTokenStore } from './modules/auth/sessionStore.js';
import { createSessionService } from './modules/auth/sessions.js';
import { createTokenService } from './modules/auth/tokens.js';
import { boardRoutes } from './modules/boards/routes.js';
import { createBoardService } from './modules/boards/service.js';
import { inviteRoutes } from './modules/invites/routes.js';
import { createInviteService } from './modules/invites/service.js';
import { createRoomEvents, type RoomEvents } from './modules/rooms/events.js';
import { createRoomPolicy } from './modules/rooms/policy.js';
import { roomRoutes } from './modules/rooms/routes.js';
import { createRoomService } from './modules/rooms/service.js';
import { userRoutes } from './modules/users/routes.js';
import { registerCsrf } from './plugins/csrf.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';

/** minimal pino destination (pino itself comes in through fastify) */
export interface LogStream {
  write(line: string): void;
}

export interface AppDeps {
  config: Config;
  prisma: PrismaClient;
  redis: Redis;
  /** override dependency probes (tests) */
  checks?: HealthChecks;
  /** send logs here instead of stdout (tests capture them to prove no secrets leak) */
  logStream?: LogStream;
}

// SECURITY §7: never log credentials, cookies or tokens — even if a future log call includes them.
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.access',
  '*.refresh',
  '*.raw',
];

function loggerOptions(config: Config, stream?: LogStream): FastifyServerOptions['logger'] {
  const base = { level: config.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } };
  if (stream) return { ...base, stream };
  if (config.NODE_ENV === 'test') return false;
  return config.NODE_ENV === 'development'
    ? { ...base, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : base;
}

export async function buildApp({ config, prisma, redis, checks, logStream }: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config, logStream),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 100 * 1024, // SECURITY §6: REST bodies ≤ 100 KB
    genReqId: () => randomUUID(),
    requestIdHeader: false, // never trust a client-supplied request id
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  registerPolicy(app);
  registerCsrf(app, config.APP_ORIGIN);
  await app.register(cookie);
  await registerRateLimit(app, redis, config.RATE_LIMITS_ENABLED);

  // ---- services ----------------------------------------------------------------------
  const tokens = createTokenService({
    secret: config.JWT_SECRET,
    previousSecret: config.JWT_SECRET_PREVIOUS,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    ttlSec: config.ACCESS_TOKEN_TTL_SEC,
  });
  const revocations = createRevocationList(redis, config.ACCESS_TOKEN_TTL_SEC);
  const sessions = createSessionService({
    store: createPrismaRefreshTokenStore(prisma),
    ttlDays: config.REFRESH_TOKEN_TTL_DAYS,
    reuseGraceSec: config.REFRESH_REUSE_GRACE_SEC,
    onReuse: ({ userId, familyId }) => {
      app.log.warn({ userId, familyId }, 'refresh token reuse detected — session family revoked');
      void revocations.revoke([familyId]);
    },
  });
  const cookies = createAuthCookies({
    secure: config.COOKIE_SECURE,
    domain: config.COOKIE_DOMAIN,
    accessTtlSec: config.ACCESS_TOKEN_TTL_SEC,
    refreshTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
  });
  const passwords = createPasswordHasher({
    memoryCost: config.ARGON2_MEMORY_KIB,
    timeCost: config.ARGON2_ITERATIONS,
  });
  const auth = createAuthService({
    prisma,
    tokens,
    sessions,
    revocations,
    passwords,
    lockout: createLockout(prisma, redis),
  });
  const events = createRoomEvents();
  app.decorate('roomEvents', events);
  const policy = createRoomPolicy(prisma, redis);
  const rooms = createRoomService({
    prisma,
    policy,
    events,
    passwords,
    limits: { maxOwnedRooms: config.MAX_OWNED_ROOMS, maxRoomMembers: config.MAX_ROOM_MEMBERS },
  });
  const invites = createInviteService({
    prisma,
    redis,
    policy,
    events,
    passwords,
    appOrigin: config.APP_ORIGIN,
  });
  const boards = createBoardService({ prisma, policy, events });

  app.decorate('authenticate', async (request) => {
    const token = cookies.readAccess(request);
    if (!token) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
    const claims = await tokens.verify(token);
    if (await revocations.isRevoked(claims.sid)) {
      throw new AppError('UNAUTHENTICATED', 'Session ended, please log in again');
    }
    return { id: claims.sub, sid: claims.sid };
  });

  // ---- routes ------------------------------------------------------------------------
  await app.register(healthRoutes, {
    checks: checks ?? {
      db: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        await redis.ping();
      },
    },
  });
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    auth,
    cookies,
    redis,
    rateLimits: config.RATE_LIMITS_ENABLED,
    ipHashSalt: config.IP_HASH_SALT,
  });
  await app.register(userRoutes, { prefix: '/api/v1', auth });
  const rateLimits = config.RATE_LIMITS_ENABLED;
  await app.register(roomRoutes, { prefix: '/api/v1', rooms, invites, boards, redis, rateLimits });
  await app.register(inviteRoutes, { prefix: '/api/v1', invites, redis, rateLimits });
  await app.register(boardRoutes, { prefix: '/api/v1', boards });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    /** REST → realtime bridge; Phase 5 subscribes (member:kicked, board:created, …) */
    roomEvents: RoomEvents;
  }
}
