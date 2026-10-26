import { z } from 'zod';

// Booleans from env: never z.coerce.boolean() — it turns "false" into true (ENVIRONMENT §6).
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_ORIGIN: z.url(),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    JWT_SECRET_PREVIOUS: optionalString,
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    COOKIE_SECURE: bool,
    COOKIE_DOMAIN: optionalString,
    IP_HASH_SALT: z.string().min(16),
    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
    ARGON2_ITERATIONS: z.coerce.number().int().positive().default(2),
    MAX_ROOM_MEMBERS: z.coerce.number().int().min(2).max(50).default(16),
    MAX_BOARDS_PER_ROOM: z.coerce.number().int().positive().default(20),
    MAX_ELEMENTS_PER_BOARD: z.coerce.number().int().positive().default(5000),
    MAX_OWNED_ROOMS: z.coerce.number().int().positive().default(30),
    CORS_DEV_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: bool,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    EMAIL_ENABLED: bool.default(false),
    /** outgoing mail (AUTH-7); required when EMAIL_ENABLED=true. Dev: Mailpit on 1025 */
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: z.string().default('RotationLab <no-reply@example.com>'),
    /** Rate limits (SECURITY §6). Only for local E2E/dev convenience — forced on in production. */
    RATE_LIMITS_ENABLED: bool.default(true),
    /**
     * A rotated refresh token presented again within this many seconds is treated as a
     * concurrent refresh (two tabs), not theft: 409, no family revocation.
     */
    REFRESH_REUSE_GRACE_SEC: z.coerce.number().int().min(0).max(60).default(10),
    /** sockets are disconnected (code TOKEN_EXPIRED) this long after their access token expires */
    SOCKET_TOKEN_GRACE_SEC: z.coerce.number().int().min(0).max(600).default(60),
    SENTRY_DSN: optionalString,
    METRICS_TOKEN: optionalString,
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && !e.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
    if (e.NODE_ENV === 'production' && !e.RATE_LIMITS_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMITS_ENABLED'],
        message: 'rate limits cannot be disabled in production',
      });
    }
    if (e.EMAIL_ENABLED && !e.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'required when EMAIL_ENABLED=true',
      });
    }
    if (e.COOKIE_SECURE && e.COOKIE_DOMAIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_DOMAIN'],
        message: 'must be empty when COOKIE_SECURE=true (the __Host- cookie prefix forbids Domain)',
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

/** Parses env and fails fast with a readable list of problems (never echoes values). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid server environment:\n${problems}`);
  }
  return result.data;
}
