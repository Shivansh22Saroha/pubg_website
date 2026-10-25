import { HealthResponseSchema } from '@rotationlab/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import type { HealthChecks } from '../src/routes/health.js';

const config = { NODE_ENV: 'test', LOG_LEVEL: 'silent', TRUST_PROXY: false } as const;
const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error('down'));

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function getHealth(checks: HealthChecks) {
  app = await buildApp({ config, checks });
  return app.inject({ method: 'GET', url: '/api/health' });
}

describe('GET /api/health', () => {
  it('returns 200 and ok when all dependencies are up', async () => {
    const res = await getHealth({ db: ok, redis: ok });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 and degraded when the database is down', async () => {
    const res = await getHealth({ db: fail, redis: ok });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'error', redis: 'ok' });
  });

  it('returns 503 when redis is down', async () => {
    const res = await getHealth({ db: ok, redis: fail });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'ok', redis: 'error' });
  });

  it('treats a hanging check as an error instead of hanging the request', async () => {
    const hang = () => new Promise<void>(() => undefined);
    const res = await getHealth({ db: hang, redis: ok });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ db: 'error' });
  });
});
