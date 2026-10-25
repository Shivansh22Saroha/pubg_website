import { ApiErrorBodySchema } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { APP_ORIGIN } from '../helpers.js';
import {
  call,
  CSRF,
  login,
  makeApp,
  PASSWORD,
  register,
  setCookies,
  useCleanState,
} from './harness.js';

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp());
});

const code = (res: { json: () => unknown }) => ApiErrorBodySchema.parse(res.json()).error.code;
const loginBody = { identifier: 'alice', password: PASSWORD };

describe('CSRF (API_SPEC §1.2, SECURITY T3)', () => {
  const post = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: loginBody });

  it('rejects a mutating request without X-Requested-With', async () => {
    const res = await post({ origin: APP_ORIGIN });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('CSRF_FAILED');
  });

  it('rejects a wrong X-Requested-With value', async () => {
    expect(
      (await post({ origin: APP_ORIGIN, 'x-requested-with': 'XMLHttpRequest' })).statusCode,
    ).toBe(403);
  });

  it('rejects a foreign or missing Origin', async () => {
    expect(
      (await post({ origin: 'https://evil.example', 'x-requested-with': 'rotationlab' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post({
          origin: 'http://localhost:3000.evil.example',
          'x-requested-with': 'rotationlab',
        })
      ).statusCode,
    ).toBe(403);
    expect((await post({ 'x-requested-with': 'rotationlab' })).statusCode).toBe(403);
  });

  it('applies to authenticated routes and to PATCH/DELETE too', async () => {
    const { jar } = await register(app);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      cookies: jar.cookies,
      payload: { displayName: 'x' },
    });
    expect(patch.statusCode).toBe(403);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/sessions/0192f7a1-0000-7000-8000-000000000000',
      cookies: jar.cookies,
      headers: { origin: 'https://evil.example', 'x-requested-with': 'rotationlab' },
    });
    expect(del.statusCode).toBe(403);
  });

  it('lets safe methods through without the header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/username-available?u=bob' });
    expect(res.statusCode).toBe(200);
  });
});

describe('rate limits (SECURITY §6)', () => {
  it('11th login in a minute from one IP → 429 RATE_LIMITED with Retry-After', async () => {
    const statuses: number[] = [];
    let last: Awaited<ReturnType<App['inject']>> | undefined;
    for (let i = 0; i < 11; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: CSRF,
        payload: { identifier: `nobody${i}`, password: 'whatever whatever' },
      });
      statuses.push(last.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(code(last!)).toBe('RATE_LIMITED');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts per IP: another address is not affected', async () => {
    for (let i = 0; i < 11; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: CSRF,
        payload: { identifier: 'x', password: 'whatever whatever' },
        remoteAddress: '10.0.0.1',
      });
    }
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { identifier: 'x', password: 'whatever whatever' },
      remoteAddress: '10.0.0.2',
    });
    expect(other.statusCode).toBe(401);
  });

  it('register: 6th registration in an hour → 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { res } = await register(app, undefined, {
        email: `u${i}@example.com`,
        username: `user_${i}`,
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('username-available: 21st check in a minute → 429', async () => {
    let last: Awaited<ReturnType<App['inject']>> | undefined;
    for (let i = 0; i < 21; i++) {
      last = await app.inject({ method: 'GET', url: `/api/v1/auth/username-available?u=n${i}x` });
    }
    expect(last!.statusCode).toBe(429);
  });
});

describe('cookie attributes (SECURITY A5, API_SPEC §1.1)', () => {
  it('dev (COOKIE_SECURE=false): plain names, HttpOnly, SameSite, paths, max-age', async () => {
    const { res } = await register(app);
    const [at, rt] = ['rl_at', 'rl_rt'].map((n) => setCookies(res).find((c) => c.name === n)!);
    expect(at!.attrs).toMatchObject({
      httponly: true,
      samesite: 'Lax',
      path: '/',
      'max-age': '900',
    });
    expect(at!.attrs.secure).toBeUndefined();
    expect(rt!.attrs).toMatchObject({
      httponly: true,
      samesite: 'Strict',
      path: '/api/v1/auth',
      'max-age': String(30 * 24 * 3600),
    });
  });

  it('production config: __Host- access cookie and __Secure- refresh cookie, Secure, no Domain', async () => {
    const { app: prod } = await makeApp({ NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    const { res } = await register(prod);
    const cookies = setCookies(res);
    expect(cookies.map((c) => c.name).sort()).toEqual(['__Host-rl_at', '__Secure-rl_rt']);
    const at = cookies.find((c) => c.name === '__Host-rl_at')!;
    const rt = cookies.find((c) => c.name === '__Secure-rl_rt')!;
    expect(at.attrs).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Lax',
      path: '/',
      'max-age': '900',
    });
    expect(rt.attrs).toMatchObject({
      httponly: true,
      secure: true,
      samesite: 'Strict',
      path: '/api/v1/auth',
    });
    for (const c of cookies) expect(c.attrs.domain).toBeUndefined();

    // and the prod app reads the prefixed names
    const me = await prod.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { '__Host-rl_at': at.value },
    });
    expect(me.statusCode).toBe(200);
    const plain = await prod.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { rl_at: at.value },
    });
    expect(plain.statusCode).toBe(401);
  });
});

describe('secrets never leak (exit criterion)', () => {
  it('no token, password or cookie value appears in any log line, response body or URL', async () => {
    const { app: logged, logs } = await makeApp({ LOG_LEVEL: 'trace' });
    const secrets = new Set<string>([PASSWORD, 'a brand new passphrase']);
    const bodies: string[] = [];
    const track = (res: { body: string; headers: Record<string, unknown> }) => {
      bodies.push(res.body);
    };

    const { res: reg, jar } = await register(logged);
    track(reg);
    const { res: li, jar: jar2 } = await login(logged, 'alice');
    track(li);
    for (const j of [jar, jar2]) for (const v of Object.values(j.cookies)) secrets.add(v);

    track(await call(logged, jar, 'GET', '/api/v1/me'));
    track(await call(logged, jar, 'POST', '/api/v1/auth/refresh'));
    for (const v of Object.values(jar.cookies)) secrets.add(v);
    track(await call(logged, jar, 'GET', '/api/v1/me/sessions'));
    track(
      await call(logged, jar, 'POST', '/api/v1/me/password', {
        currentPassword: PASSWORD,
        newPassword: 'a brand new passphrase',
      }),
    );
    track(await call(logged, jar2, 'GET', '/api/v1/me')); // revoked → logged 401
    track(await login(logged, 'alice', 'definitely wrong!').then((r) => r.res));
    // an error path that logs the request
    track(
      await logged.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: CSRF,
        cookies: jar2.cookies,
      }),
    );
    track(await call(logged, jar, 'POST', '/api/v1/auth/logout'));

    expect(logs.lines.length).toBeGreaterThan(10);
    // every request URL the server saw, from its own request logs
    const urls = logs.lines
      .map((l) => (JSON.parse(l) as { req?: { url?: string } }).req?.url)
      .filter((u): u is string => typeof u === 'string');
    expect(urls.length).toBeGreaterThan(5);
    const haystacks = {
      logs: logs.lines.join('\n'),
      bodies: bodies.join('\n'),
      urls: urls.join('\n'),
    };
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(8);
      for (const [where, text] of Object.entries(haystacks)) {
        expect(text.includes(secret), `secret found in ${where}`).toBe(false);
      }
    }
    // and the JWT shape never shows up either
    expect(/eyJ[\w-]+\.eyJ[\w-]+\./.test(haystacks.logs)).toBe(false);
  });
});
