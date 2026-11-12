import { PublicConfigResponseSchema, UserResponseSchema } from '@rotationlab/shared';
import { describe, expect, it } from 'vitest';
import type { GoogleClient, GoogleProfile } from '../../src/modules/auth/google.js';
import { call, Jar, makeApp, prisma, register, useCleanState } from './harness.js';

/** FEATURES F17: Sign in with Google — the server half, with a fake Google. */
function fakeGoogle(profile: Partial<GoogleProfile> = {}) {
  const seen: { verifier?: string; nonce?: string } = {};
  const client: GoogleClient = {
    authUrl: ({ state, challenge, nonce }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&code_challenge=${challenge}&nonce=${nonce}`,
    exchange: async ({ code, verifier, nonce }) => {
      if (code !== 'good-code') throw new Error('bad code');
      seen.verifier = verifier;
      seen.nonce = nonce;
      return {
        sub: 'google-sub-1',
        email: 'shiva.s@gmail.com',
        emailVerified: true,
        name: 'Shiva S',
        ...profile,
      };
    },
  };
  return { client, seen };
}

/** GET /google/start → the state from Google's URL + the browser-binding cookie */
async function start(app: Awaited<ReturnType<typeof makeApp>>['app'], jar: Jar, next?: string) {
  const res = await call(
    app,
    jar,
    'GET',
    `/api/v1/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ''}`,
  );
  expect(res.statusCode).toBe(303);
  const url = new URL(String(res.headers.location));
  expect(url.origin).toBe('https://accounts.google.com');
  return url.searchParams.get('state') ?? '';
}

const callback = (app: Awaited<ReturnType<typeof makeApp>>['app'], jar: Jar, q: string) =>
  call(app, jar, 'GET', `/api/v1/auth/google/callback?${q}`);

describe('Sign in with Google', () => {
  useCleanState();

  it('a new Google user gets an account (verified email, username from the email, no password)', async () => {
    const { client } = fakeGoogle();
    const { app } = await makeApp({}, { google: client });
    const cfg = PublicConfigResponseSchema.parse(
      (await call(app, new Jar(), 'GET', '/api/v1/config')).json(),
    );
    expect(cfg.googleEnabled).toBe(true);

    const jar = new Jar();
    const state = await start(app, jar, '/rooms/abc');
    const res = await callback(app, jar, `code=good-code&state=${state}`);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/dashboard?welcome=google'); // new account: dashboard
    const me = UserResponseSchema.parse((await call(app, jar, 'GET', '/api/v1/me')).json()).user;
    expect(me).toMatchObject({
      username: 'shiva_s',
      displayName: 'Shiva S',
      email: 'shiva.s@gmail.com',
      emailVerified: true,
      hasPassword: false,
    });
    // a password can't log in to it
    const login = await call(app, new Jar(), 'POST', '/api/v1/auth/login', {
      identifier: 'shiva.s@gmail.com',
      password: '!google',
    });
    expect(login.statusCode).toBe(401);

    // next time: the same account, and `next` is honoured
    const jar2 = new Jar();
    const state2 = await start(app, jar2, '/rooms/abc');
    const again = await callback(app, jar2, `code=good-code&state=${state2}`);
    expect(again.headers.location).toBe('/rooms/abc');
    expect(await prisma.user.count({ where: { email: 'shiva.s@gmail.com' } })).toBe(1);
  });

  it('links an existing password account with the same verified email (lockout cleared)', async () => {
    const { app } = await makeApp({}, { google: fakeGoogle({ email: 'old@example.com' }).client });
    const reg = await register(app, new Jar(), { email: 'old@example.com', username: 'oldie' });
    const user = UserResponseSchema.parse(reg.res.json()).user;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 9, lockedUntil: new Date(Date.now() + 3600_000) },
    });
    const jar = new Jar();
    const state = await start(app, jar);
    const res = await callback(app, jar, `code=good-code&state=${state}`);
    expect(res.headers.location).toBe('/dashboard');
    const me = UserResponseSchema.parse((await call(app, jar, 'GET', '/api/v1/me')).json()).user;
    expect(me).toMatchObject({
      id: user.id,
      username: 'oldie',
      hasPassword: true,
      emailVerified: true,
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({
      googleSub: 'google-sub-1',
      failedLoginCount: 0,
      lockedUntil: null,
    });
  });

  it('refuses: a missing or mismatched state cookie, a reused state, a bad code, an unverified email', async () => {
    const { app } = await makeApp({}, { google: fakeGoogle().client });
    // state started in another browser (login CSRF): no matching cookie here
    const state = await start(app, new Jar());
    expect((await callback(app, new Jar(), `code=good-code&state=${state}`)).headers.location).toBe(
      '/login?error=google',
    );
    // reuse: the first callback consumes it
    const jar = new Jar();
    const s2 = await start(app, jar);
    await callback(app, jar, `code=bad&state=${s2}`);
    expect((await callback(app, jar, `code=good-code&state=${s2}`)).headers.location).toMatch(
      /^\/login\?error=google/,
    );
    // the user pressed Cancel at Google
    const jar3 = new Jar();
    const s3 = await start(app, jar3);
    expect((await callback(app, jar3, `error=access_denied&state=${s3}`)).headers.location).toBe(
      '/login?error=google_cancelled',
    );

    const { app: app2 } = await makeApp(
      {},
      { google: fakeGoogle({ emailVerified: false }).client },
    );
    const jar4 = new Jar();
    const s4 = await start(app2, jar4);
    expect((await callback(app2, jar4, `code=good-code&state=${s4}`)).headers.location).toBe(
      '/login?error=google',
    );
    expect(await prisma.user.count({ where: { email: 'shiva.s@gmail.com' } })).toBe(0);
  });

  it('an open redirect in `next` falls back to the dashboard', async () => {
    const { app } = await makeApp({}, { google: fakeGoogle().client });
    await register(app, new Jar(), { email: 'shiva.s@gmail.com', username: 'shiva' });
    const jar = new Jar();
    const state = await start(app, jar, '//evil.example/steal');
    expect((await callback(app, jar, `code=good-code&state=${state}`)).headers.location).toBe(
      '/dashboard',
    );
  });

  it('not configured: 404, and the config says so', async () => {
    const { app } = await makeApp({}, { google: null });
    expect((await call(app, new Jar(), 'GET', '/api/v1/auth/google/start')).statusCode).toBe(404);
    const cfg = PublicConfigResponseSchema.parse(
      (await call(app, new Jar(), 'GET', '/api/v1/config')).json(),
    );
    expect(cfg.googleEnabled).toBe(false);
  });

  it('a Google-only account sets a first password without a current one; destructive actions ask for it first', async () => {
    const { app } = await makeApp({}, { google: fakeGoogle().client });
    const jar = new Jar();
    const state = await start(app, jar);
    await callback(app, jar, `code=good-code&state=${state}`);
    const del = await call(app, jar, 'DELETE', '/api/v1/me', {
      password: 'whatever-123',
      confirm: 'DELETE',
      rooms: [],
    });
    expect(del.statusCode).toBe(400);
    expect(JSON.stringify(del.json())).toMatch(/Set a password in Settings first/);
    const set = await call(app, jar, 'POST', '/api/v1/me/password', {
      newPassword: 'a brand new passphrase 9',
    });
    expect(set.statusCode).toBe(204);
    const me = UserResponseSchema.parse((await call(app, jar, 'GET', '/api/v1/me')).json()).user;
    expect(me.hasPassword).toBe(true);
    // now the current password is required like everyone else
    const again = await call(app, jar, 'POST', '/api/v1/me/password', {
      newPassword: 'another long passphrase 77',
    });
    expect(again.statusCode).toBe(401);
  });
});
