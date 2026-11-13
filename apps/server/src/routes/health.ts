import {
  HealthResponseSchema,
  LiveResponseSchema,
  type DependencyStatus,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { VERSION } from '../lib/version.js';

export type HealthCheck = () => Promise<void>;

export interface HealthChecks {
  db: HealthCheck;
  redis: HealthCheck;
}

const CHECK_TIMEOUT_MS = 1500;

async function probe(check: HealthCheck): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('health check timed out'));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** `GET /api/health` — public, no auth; 503 when a dependency is down. */
export const healthRoutes: FastifyPluginCallbackZod<{ checks: HealthChecks }> = (
  app,
  { checks },
  done,
) => {
  app.get(
    '/api/health',
    {
      config: { access: 'public' },
      schema: { response: { 200: HealthResponseSchema, 503: HealthResponseSchema } },
    },
    async (_request, reply) => {
      const [db, redis] = await Promise.all([probe(checks.db), probe(checks.redis)]);
      const status = db === 'ok' && redis === 'ok' ? 'ok' : 'degraded';
      return reply
        .status(status === 'ok' ? 200 : 503)
        .header('cache-control', 'no-store')
        .send({ status, db, redis, version: VERSION });
    },
  );
  /**
   * `GET /api/live` — liveness only: answers without touching Postgres or Redis, so an uptime
   * ping that keeps the free Render instance awake doesn't also keep Neon awake (its free plan
   * counts compute hours). Deep checks stay on /api/health.
   */
  app.get(
    '/api/live',
    { config: { access: 'public' }, schema: { response: { 200: LiveResponseSchema } } },
    async (_request, reply) =>
      reply.header('cache-control', 'no-store').send({ status: 'ok', version: VERSION }),
  );
  done();
};
