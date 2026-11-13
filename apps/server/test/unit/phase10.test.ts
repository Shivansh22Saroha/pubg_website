import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { unitApp } from '../helpers.js';

const up = { db: () => Promise.resolve(), redis: () => Promise.resolve() };

let app: App | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('security headers (SECURITY §5 T4, TESTING §5.6)', () => {
  it('every API response denies framing and content, sniffing and cross-origin reads', async () => {
    app = await unitApp(up);
    for (const url of ['/api/health', '/api/v1/nope']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('HSTS only when deployed over HTTPS (COOKIE_SECURE=true)', async () => {
    app = await unitApp(up);
    expect((await app.inject('/api/health')).headers['strict-transport-security']).toBeUndefined();
    await app.close();
    app = await unitApp(up, { COOKIE_SECURE: 'true' });
    expect((await app.inject('/api/health')).headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
  });
});

describe('maintenance mode (DEPLOYMENT §7)', () => {
  it('answers 503 MAINTENANCE with Retry-After, but health, live and metrics stay up', async () => {
    app = await unitApp(up, { MAINTENANCE: 'true' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/rooms' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'MAINTENANCE' } });
    expect(res.headers['retry-after']).toBe('300');
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/live')).statusCode).toBe(200);
    expect((await app.inject('/metrics')).statusCode).toBe(200);
  });

  it('is off by default', async () => {
    app = await unitApp(up);
    expect((await app.inject('/api/v1/rooms')).statusCode).toBe(401);
  });
});

describe('GET /metrics', () => {
  it('exposes process and per-route REST metrics', async () => {
    app = await unitApp(up);
    await app.inject('/api/health');
    const res = await app.inject('/metrics');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('process_cpu_user_seconds_total');
    expect(res.body).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/api\/health",status="200"\} 1/,
    );
  });

  it('with METRICS_TOKEN: 404 without the bearer token, 200 with it', async () => {
    app = await unitApp(up, { METRICS_TOKEN: 'scrape-secret-123' });
    expect((await app.inject('/metrics')).statusCode).toBe(404);
    const wrong = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer nope' } });
    expect(wrong.statusCode).toBe(404);
    const ok = await app.inject({
      url: '/metrics',
      headers: { authorization: 'Bearer scrape-secret-123' },
    });
    expect(ok.statusCode).toBe(200);
  });
});
