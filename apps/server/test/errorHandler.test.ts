import { ApiErrorBodySchema } from '@rotationlab/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type App } from '../src/app.js';
import { AppError } from '../src/lib/errors.js';

const config = { NODE_ENV: 'test', LOG_LEVEL: 'silent', TRUST_PROXY: false } as const;

let app: App;
beforeEach(async () => {
  app = await buildApp({ config, checks: { db: async () => {}, redis: async () => {} } });
  app.get('/boom', () => {
    throw new Error('secret internal detail');
  });
  app.get('/forbidden', () => {
    throw new AppError('FORBIDDEN', 'Not allowed');
  });
  app.post(
    '/echo',
    { schema: { body: z.object({ name: z.string().min(3) }).strict() } },
    (req) => req.body,
  );
});
afterEach(async () => {
  await app.close();
});

describe('error handler', () => {
  it('maps AppError to its status and the standard shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(res.statusCode).toBe(403);
    const body = ApiErrorBodySchema.parse(res.json());
    expect(body.error).toMatchObject({ code: 'FORBIDDEN', message: 'Not allowed' });
    expect(body.error.requestId).toBeTruthy();
  });

  it('returns 500 INTERNAL without leaking the original message', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(res.body).not.toContain('secret internal detail');
  });

  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorBodySchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR with field details for bad bodies', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: 'ab' } });
    expect(res.statusCode).toBe(400);
    const body = ApiErrorBodySchema.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ path: 'name', issue: 'too_small' }]);
  });

  it('rejects unknown keys on strict input schemas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { name: 'alice', admin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 413 PAYLOAD_TOO_LARGE above the 100 KB body limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { name: 'x'.repeat(101 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('ignores a client-supplied request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'request-id': 'attacker-controlled' },
    });
    expect(ApiErrorBodySchema.parse(res.json()).error.requestId).not.toBe('attacker-controlled');
  });
});
