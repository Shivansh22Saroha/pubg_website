import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { buildApp, type LogStream } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { HealthChecks } from '../src/routes/health.js';

export const APP_ORIGIN = 'http://localhost:3000';

/** Headers every mutating test request needs to pass the CSRF check. */
export const CSRF = { origin: APP_ORIGIN, 'x-requested-with': 'rotationlab' } as const;

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '4000',
    APP_ORIGIN,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://rl:x@localhost:5432/unused',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    JWT_SECRET: 'test-secret-'.padEnd(48, 'x'),
    JWT_ISSUER: 'rotationlab',
    JWT_AUDIENCE: 'rotationlab-web',
    COOKIE_SECURE: 'false',
    IP_HASH_SALT: 'test-salt-'.padEnd(32, 'y'),
    TRUST_PROXY: 'false',
    LOG_LEVEL: 'info',
    // cheap argon2 for tests; production defaults are 19 MiB / 2
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_ITERATIONS: '1',
    RATE_LIMITS_ENABLED: 'true',
    ...overrides,
  });
}

/**
 * App for unit tests that never touch Postgres/Redis: clients are created lazily and never
 * connect, rate limiting (which needs Redis) is off.
 */
export async function unitApp(checks: HealthChecks) {
  const config = testConfig({ RATE_LIMITS_ENABLED: 'false' });
  const prisma = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0 });
  const app = await buildApp({ config, prisma, redis, checks });
  app.addHook('onClose', () => {
    redis.disconnect();
  });
  return app;
}

/** Collects every log line so tests can assert nothing secret was logged. */
export function captureLogs(): LogStream & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write(line: string) {
      lines.push(line);
    },
  };
}
