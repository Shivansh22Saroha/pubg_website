import { PublicConfigResponseSchema } from '@rotationlab/shared';
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
import { registerMetrics } from './lib/metrics.js';
import { registerPolicy } from './lib/policy.js';
import { createAuthCookies } from './modules/auth/cookies.js';
import { createLockout } from './modules/auth/lockout.js';
import { createPasswordHasher } from './modules/auth/passwords.js';
import { createRevocationList } from './modules/auth/revocation.js';
import { authRoutes } from './modules/auth/routes.js';
import { createSocketTickets } from './modules/auth/socketTickets.js';
import { createAuthService } from './modules/auth/service.js';
import { createPrismaRefreshTokenStore } from './modules/auth/sessionStore.js';
import { createSessionService } from './modules/auth/sessions.js';
import { createTokenService } from './modules/auth/tokens.js';
import { createBoardOpsService } from './modules/elements/service.js';
import { createRealtime, disconnectSessions } from './realtime/server.js';
import { boardRoutes } from './modules/boards/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { createChatService } from './modules/chat/service.js';
import { registerSystemMessages } from './modules/chat/system.js';
import { snapshotRoutes } from './modules/snapshots/routes.js';
import { createAccountService } from './modules/users/account.js';
import { createEmailFlows } from './modules/auth/emailFlows.js';
import { createEmailTokens } from './modules/auth/emailTokens.js';
import { createMemoryMailer, createSmtpMailer, type Mailer } from './lib/mailer.js';
import { createSnapshotService } from './modules/snapshots/service.js';
import { publicRoutes } from './modules/public/routes.js';
import { createPublicService } from './modules/public/service.js';
import { shareRoutes } from './modules/share/routes.js';
import { thumbnailRoutes } from './modules/thumbnails/routes.js';
import { createThumbnailService } from './modules/thumbnails/service.js';
import { createAssetStorage, type AssetStorage } from './lib/storage.js';
import { createShareService } from './modules/share/service.js';
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
import { registerMaintenance } from './plugins/maintenance.js';
import { registerRateLimit } from './plugins/rateLimit.js';
import { registerSecurityHeaders } from './plugins/securityHeaders.js';
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
  /** attach Socket.IO (default true; REST-only unit tests turn it off) */
  realtime?: boolean;
  /** outgoing mail (tests pass an in-memory mailer); default: SMTP when EMAIL_ENABLED */
  mailer?: Mailer;
  /** board thumbnail storage (tests pass a temp dir); default: from config (S3 or local disk) */
  assets?: AssetStorage;
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

/** Share-link tokens are bearer credentials in the path: never log them (Phase 11). */
export function maskUrl(url: string): string {
  return url.replace(/(\/public\/share\/)[^/?#]+/, '$1[redacted]');
}

/** Fastify's default request serializer, with the URL masked. */
const serializers = {
  req(req: {
    method: string;
    url: string;
    headers: Record<string, unknown>;
    host?: string;
    ip?: string;
    socket?: { remotePort?: number };
  }) {
    return {
      method: req.method,
      url: maskUrl(req.url),
      version:
        typeof req.headers['accept-version'] === 'string'
          ? req.headers['accept-version']
          : undefined,
      host: req.host,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    };
  },
};

function loggerOptions(config: Config, stream?: LogStream): FastifyServerOptions['logger'] {
  const base = {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers,
  };
  if (stream) return { ...base, stream };
  if (config.NODE_ENV === 'test') return false;
  return config.NODE_ENV === 'development'
    ? { ...base, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : base;
}

export async function buildApp({
  config,
  prisma,
  redis,
  checks,
  logStream,
  realtime: withRealtime = true,
  mailer,
  assets = createAssetStorage(config),
}: AppDeps) {
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
  await registerSecurityHeaders(app, config.COOKIE_SECURE);
  registerMaintenance(app, config.MAINTENANCE);
  const metrics = registerMetrics(app, config.METRICS_TOKEN);
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
  // late-bound: realtime is created after the services that revoke sessions
  let dropSessions: (sids: string[]) => void = () => undefined;
  const tickets = createSocketTickets(redis);
  const revocations = createRevocationList(redis, config.ACCESS_TOKEN_TTL_SEC, (sids) => {
    dropSessions(sids);
  });
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
  const lockout = createLockout(prisma, redis);
  const auth = createAuthService({
    prisma,
    tokens,
    sessions,
    revocations,
    passwords,
    lockout,
  });
  const email = createEmailFlows({
    prisma,
    tokens: createEmailTokens(prisma),
    mailer:
      mailer ??
      (config.EMAIL_ENABLED && config.SMTP_HOST
        ? createSmtpMailer({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
            from: config.SMTP_FROM,
          })
        : createMemoryMailer()),
    passwords,
    sessions,
    revocations,
    lockout,
    appOrigin: config.APP_ORIGIN,
    enabled: config.EMAIL_ENABLED,
    log: app.log,
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
    assetUrl: (key) => assets.url(key),
  });
  const invites = createInviteService({
    prisma,
    redis,
    policy,
    events,
    passwords,
    appOrigin: config.APP_ORIGIN,
  });
  const boards = createBoardService({ prisma, policy, events, assets });
  app.decorate('assets', assets);
  const boardOps = createBoardOpsService({ prisma, redis, policy, events });
  const snapshots = createSnapshotService({ prisma, policy, events });
  const account = createAccountService({ prisma, passwords, revocations, policy, events });
  const chat = createChatService({ prisma, policy, events });
  const systemMessages = registerSystemMessages(events, chat, prisma, app.log);
  app.decorate('chatIdle', systemMessages.idle);
  app.addHook('preClose', systemMessages.idle);

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
    email,
    tokens,
    tickets,
  });
  await app.register(userRoutes, { prefix: '/api/v1', auth, account, cookies });
  app.get(
    '/api/v1/config',
    { config: { access: 'public' }, schema: { response: { 200: PublicConfigResponseSchema } } },
    () => ({ emailEnabled: config.EMAIL_ENABLED }),
  );
  const rateLimits = config.RATE_LIMITS_ENABLED;
  await app.register(roomRoutes, { prefix: '/api/v1', rooms, invites, boards, redis, rateLimits });
  await app.register(inviteRoutes, { prefix: '/api/v1', invites, redis, rateLimits });
  await app.register(boardRoutes, { prefix: '/api/v1', boards });
  await app.register(chatRoutes, { prefix: '/api/v1', chat });
  await app.register(snapshotRoutes, { prefix: '/api/v1', snapshots });
  await app.register(publicRoutes, {
    prefix: '/api/v1',
    service: createPublicService({ prisma, demoBoardIds: config.DEMO_BOARD_IDS }),
  });
  await app.register(thumbnailRoutes, {
    prefix: '/api/v1',
    storage: assets,
    thumbnails: createThumbnailService({ prisma, policy, storage: assets, log: app.log }),
  });
  await app.register(shareRoutes, {
    prefix: '/api/v1',
    share: createShareService({ prisma, policy, appOrigin: config.APP_ORIGIN }),
  });

  // ---- realtime (Socket.IO on the same HTTP server, path /realtime) -------------------
  if (withRealtime) {
    const realtime = createRealtime({
      app,
      redis,
      appOrigin: config.APP_ORIGIN,
      accessCookieName: cookies.accessName,
      tokens,
      tickets,
      revocations,
      policy,
      rooms,
      boardOps,
      chat,
      events,
      tokenGraceSec: config.SOCKET_TOKEN_GRACE_SEC,
    });
    dropSessions = (sids) => {
      disconnectSessions(realtime.io, sids);
    };
    metrics.trackSockets(() => realtime.io.engine.clientsCount);
    if (config.MAINTENANCE) {
      realtime.io.use((_socket, next) => {
        next(Object.assign(new Error('MAINTENANCE'), { data: { code: 'MAINTENANCE' } }));
      });
    }
    app.addHook('preClose', async () => {
      await realtime.close();
    });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    /** REST → realtime bridge; Phase 5 subscribes (member:kicked, board:created, …) */
    roomEvents: RoomEvents;
    /** resolves when no system chat message is still being written */
    chatIdle: () => Promise<void>;
    /** board thumbnail storage (Phase 11) — also used by the purge job */
    assets: AssetStorage;
  }
}
