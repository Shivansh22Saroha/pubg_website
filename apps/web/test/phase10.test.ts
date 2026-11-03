import { describe, expect, it, vi } from 'vitest';
import { sentryOptions } from '@/lib/sentryOptions';
import { serverEnv } from '@/lib/serverEnv';

vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'test' } }));

describe('serverEnv MAINTENANCE (DEPLOYMENT §7)', () => {
  it('is off unless exactly "true"', () => {
    expect(serverEnv({ NODE_ENV: 'production' }).MAINTENANCE).toBe(false);
    expect(serverEnv({ NODE_ENV: 'production', MAINTENANCE: '' }).MAINTENANCE).toBe(false);
    expect(serverEnv({ NODE_ENV: 'production', MAINTENANCE: 'false' }).MAINTENANCE).toBe(false);
    expect(serverEnv({ NODE_ENV: 'production', MAINTENANCE: 'true' }).MAINTENANCE).toBe(true);
    expect(() => serverEnv({ NODE_ENV: 'production', MAINTENANCE: '1' })).toThrow();
  });
});

describe('sentryOptions', () => {
  it('reports errors only and collects none of the default request / user data', () => {
    const o = sentryOptions('https://key@o1.ingest.sentry.io/1');
    expect(o.tracesSampleRate).toBe(0);
    expect(o.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
    expect(o.release).toMatch(/^rotationlab-web@/);
  });
});
