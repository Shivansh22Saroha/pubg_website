import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { CSRF, makeApp, register, useCleanState, type Jar } from './harness.js';

/**
 * Authz matrix (SECURITY §3, TESTING §5.1). One row per registered route × caller. Later phases
 * add rows (and callers: non-member, VIEWER, EDITOR, OWNER). The suite FAILS if a route exists
 * without a row, so nothing ships unchecked.
 *
 * `expect` is the status for each caller; "auth" means the route must reject with 401.
 */
type Caller = 'anonymous' | 'user';
interface Row {
  method: string;
  url: string;
  /** concrete request (params filled in, body) */
  request: (ctx: { userJar: Jar }) => { url: string; payload?: object };
  expect: Record<Caller, number>;
}

const UUID = '0192f7a1-0000-7000-8000-000000000000';

const MATRIX: Row[] = [
  {
    method: 'GET',
    url: '/api/health',
    request: () => ({ url: '/api/health' }),
    expect: { anonymous: 200, user: 200 },
  },
  {
    method: 'POST',
    url: '/api/v1/auth/register',
    request: () => ({
      url: '/api/v1/auth/register',
      payload: {
        email: 'new@example.com',
        username: 'newbie',
        password: 'correct horse battery staple',
      },
    }),
    expect: { anonymous: 201, user: 201 }, // registering a second account while logged in is allowed
  },
  {
    method: 'POST',
    url: '/api/v1/auth/login',
    request: () => ({
      url: '/api/v1/auth/login',
      payload: { identifier: 'alice', password: 'wrong wrong wrong' },
    }),
    expect: { anonymous: 401, user: 401 },
  },
  {
    method: 'POST',
    url: '/api/v1/auth/refresh',
    request: () => ({ url: '/api/v1/auth/refresh' }),
    expect: { anonymous: 401, user: 204 },
  },
  {
    method: 'POST',
    url: '/api/v1/auth/logout',
    request: () => ({ url: '/api/v1/auth/logout' }),
    expect: { anonymous: 204, user: 204 },
  },
  {
    method: 'POST',
    url: '/api/v1/auth/logout-all',
    request: () => ({ url: '/api/v1/auth/logout-all' }),
    expect: { anonymous: 401, user: 204 },
  },
  {
    method: 'GET',
    url: '/api/v1/auth/username-available',
    request: () => ({ url: '/api/v1/auth/username-available?u=zed' }),
    expect: { anonymous: 200, user: 200 },
  },
  {
    method: 'GET',
    url: '/api/v1/me',
    request: () => ({ url: '/api/v1/me' }),
    expect: { anonymous: 401, user: 200 },
  },
  {
    method: 'PATCH',
    url: '/api/v1/me',
    request: () => ({ url: '/api/v1/me', payload: { ign: 'Scout' } }),
    expect: { anonymous: 401, user: 200 },
  },
  {
    method: 'POST',
    url: '/api/v1/me/password',
    request: () => ({
      url: '/api/v1/me/password',
      payload: {
        currentPassword: 'correct horse battery staple',
        newPassword: 'another fine passphrase',
      },
    }),
    expect: { anonymous: 401, user: 204 },
  },
  {
    method: 'GET',
    url: '/api/v1/me/sessions',
    request: () => ({ url: '/api/v1/me/sessions' }),
    expect: { anonymous: 401, user: 200 },
  },
  {
    method: 'DELETE',
    url: '/api/v1/me/sessions/:id',
    request: () => ({ url: `/api/v1/me/sessions/${UUID}` }),
    expect: { anonymous: 401, user: 404 }, // not this user's session → 404, never 403
  },
];

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

describe('authz matrix', () => {
  it('has exactly one row per registered route (add a row when you add a route)', () => {
    const registered = app.routeTable.map((r) => `${r.method} ${r.url}`).sort();
    const covered = MATRIX.map((r) => `${r.method} ${r.url}`).sort();
    expect(covered).toEqual(registered);
  });

  it('declares access "user" exactly where anonymous callers get 401', () => {
    for (const row of MATRIX) {
      const route = app.routeTable.find((r) => r.method === row.method && r.url === row.url);
      const needsAuth = route?.access === 'user';
      if (needsAuth) expect(row.expect.anonymous, `${row.method} ${row.url}`).toBe(401);
    }
  });

  for (const row of MATRIX) {
    for (const caller of ['anonymous', 'user'] as const) {
      it(`${row.method} ${row.url} as ${caller} → ${row.expect[caller]}`, async () => {
        const { jar } = await register(app, undefined, {
          email: 'alice@example.com',
          username: 'alice',
        });
        const { url, payload } = row.request({ userJar: jar });
        const res = await app.inject({
          method: row.method as 'GET',
          url,
          headers: row.method === 'GET' ? {} : CSRF,
          cookies: caller === 'user' ? jar.cookies : {},
          ...(payload ? { payload } : {}),
        });
        expect(res.statusCode, res.body).toBe(row.expect[caller]);
      });
    }
  }
});
