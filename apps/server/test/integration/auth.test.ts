import { ApiErrorBodySchema, UserResponseSchema } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { createTokenService } from '../../src/modules/auth/tokens.js';
import {
  call,
  CSRF,
  Jar,
  login,
  makeApp,
  PASSWORD,
  prisma,
  register,
  setCookies,
  useCleanState,
} from './harness.js';

useCleanState();

let app: App;
let config: Awaited<ReturnType<typeof makeApp>>['config'];
beforeAll(async () => {
  ({ app, config } = await makeApp());
});

const code = (res: { json: () => unknown }) => ApiErrorBodySchema.parse(res.json()).error.code;

describe('register (AUTH-1)', () => {
  it('creates the user, returns Me and sets both auth cookies', async () => {
    const { res, jar } = await register(app, undefined, {
      username: 'Alice_01',
      displayName: 'Ali',
    });
    expect(res.statusCode).toBe(201);
    const { user } = UserResponseSchema.parse(res.json());
    expect(user).toMatchObject({ username: 'alice_01', displayName: 'Ali', emailVerified: false });
    expect(Object.keys(jar.cookies).sort()).toEqual(['rl_at', 'rl_rt']);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7 from app code
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('defaults displayName to the username', async () => {
    const { res } = await register(app);
    expect(UserResponseSchema.parse(res.json()).user.displayName).toBe('alice');
  });

  it('rejects a duplicate username (case-insensitive) and a duplicate email', async () => {
    await register(app);
    const dupUser = await register(app, undefined, {
      email: 'other@example.com',
      username: 'ALICE',
    });
    expect(dupUser.res.statusCode).toBe(409);
    expect(code(dupUser.res)).toBe('USERNAME_TAKEN');
    const dupEmail = await register(app, undefined, {
      email: 'Alice@Example.com',
      username: 'bob',
    });
    expect(dupEmail.res.statusCode).toBe(409);
    expect(code(dupEmail.res)).toBe('EMAIL_TAKEN');
  });

  it('rejects weak, breached and malformed input with VALIDATION_ERROR', async () => {
    const short = await register(app, undefined, { password: 'short' });
    expect(short.res.statusCode).toBe(400);
    const breached = await register(app, undefined, { password: 'Password123' });
    expect(breached.res.statusCode).toBe(400);
    expect(ApiErrorBodySchema.parse(breached.res.json()).error.details).toEqual([
      { path: 'password', issue: 'breached' },
    ]);
    const badName = await register(app, undefined, { username: 'a b' });
    expect(badName.res.statusCode).toBe(400);
    const badEmail = await register(app, undefined, { email: 'not-an-email' });
    expect(badEmail.res.statusCode).toBe(400);
    const extra = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: CSRF,
      payload: { email: 'x@example.com', username: 'xx_1', password: PASSWORD, role: 'OWNER' },
    });
    expect(extra.statusCode).toBe(400); // .strict(): unknown keys rejected
    expect(await prisma.user.count()).toBe(0);
  });
});

describe('login (AUTH-2, SECURITY A6/A7)', () => {
  beforeAll(async () => {
    // users are truncated before each test, so each test registers its own
  });

  it('logs in by email or username, case-insensitively', async () => {
    await register(app);
    for (const id of ['alice@example.com', 'ALICE@example.com', 'alice', 'Alice']) {
      const { res, jar } = await login(app, id);
      expect(res.statusCode).toBe(200);
      expect(jar.cookies.rl_at).toBeTruthy();
    }
  });

  it('gives the same generic error for a wrong password and an unknown user', async () => {
    await register(app);
    const wrong = await login(app, 'alice', 'wrong password!!');
    const unknown = await login(app, 'nobody', 'wrong password!!');
    for (const r of [wrong.res, unknown.res]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email/username or password is incorrect' },
      });
      expect(setCookies(r)).toEqual([]);
    }
  });

  it('locks the account after 5 failures, even for the right password', async () => {
    await register(app);
    for (let i = 0; i < 5; i++) {
      expect((await login(app, 'alice', 'wrong password!!')).res.statusCode).toBe(401);
    }
    const locked = await login(app, 'alice');
    expect(locked.res.statusCode).toBe(423);
    expect(code(locked.res)).toBe('ACCOUNT_LOCKED');
    const row = await prisma.user.findUniqueOrThrow({ where: { username: 'alice' } });
    expect(row.failedLoginCount).toBe(5);
    const mins = (row.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15);
  });

  it('resets the failure counter on success', async () => {
    await register(app);
    await login(app, 'alice', 'wrong password!!');
    await login(app, 'alice');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { username: 'alice' } })).failedLoginCount,
    ).toBe(0);
  });
});

describe('access token & /me', () => {
  it('returns the current user with a valid access cookie', async () => {
    const { jar } = await register(app);
    const res = await call(app, jar, 'GET', '/api/v1/me');
    expect(res.statusCode).toBe(200);
    expect(UserResponseSchema.parse(res.json()).user.email).toBe('alice@example.com');
  });

  it('401 UNAUTHENTICATED without a cookie, TOKEN_EXPIRED with an expired one', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(anon.statusCode).toBe(401);
    expect(code(anon)).toBe('UNAUTHENTICATED');

    const { res } = await register(app);
    const { user } = UserResponseSchema.parse(res.json());
    const past = createTokenService(
      {
        secret: config.JWT_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        ttlSec: 900,
      },
      () => Date.now() - 3600_000,
    );
    const expired = await past.sign({ sub: user.id, sid: '0192f7a1-0000-7000-8000-000000000000' });
    const r = await app.inject({ method: 'GET', url: '/api/v1/me', cookies: { rl_at: expired } });
    expect(r.statusCode).toBe(401);
    expect(code(r)).toBe('TOKEN_EXPIRED');
  });

  it('updates profile fields (PATCH /me) with validation', async () => {
    const { jar } = await register(app);
    const ok = await call(app, jar, 'PATCH', '/api/v1/me', {
      displayName: '  Rudra\u0007 ',
      ign: 'SoulRudra',
      avatarColor: '#ef4444',
    });
    expect(ok.statusCode).toBe(200);
    expect(UserResponseSchema.parse(ok.json()).user).toMatchObject({
      displayName: 'Rudra', // trimmed, control char stripped
      ign: 'SoulRudra',
      avatarColor: '#EF4444',
    });
    expect((await call(app, jar, 'PATCH', '/api/v1/me', { avatarColor: 'red' })).statusCode).toBe(
      400,
    );
    expect((await call(app, jar, 'PATCH', '/api/v1/me', {})).statusCode).toBe(400);
    expect((await call(app, jar, 'PATCH', '/api/v1/me', { ign: null })).statusCode).toBe(200);
  });
});

describe('refresh rotation (AUTH-3, SECURITY A4)', () => {
  it('rotates both cookies and keeps the session id', async () => {
    const { jar } = await register(app);
    const before = { ...jar.cookies };
    const res = await call(app, jar, 'POST', '/api/v1/auth/refresh');
    expect(res.statusCode).toBe(204);
    expect(jar.cookies.rl_rt).not.toBe(before.rl_rt);
    expect(jar.cookies.rl_at).toBeTruthy();
    expect((await call(app, jar, 'GET', '/api/v1/me')).statusCode).toBe(200);
    const families = await prisma.refreshToken.groupBy({ by: ['familyId'] });
    expect(families).toHaveLength(1);
  });

  it('revokes the whole family when a rotated token is replayed (grace 0)', async () => {
    const { app: strict } = await makeApp({ REFRESH_REUSE_GRACE_SEC: '0' });
    const { jar } = await register(strict);
    const stolen = jar.cookies.rl_rt!;
    await new Promise((r) => setTimeout(r, 5));
    expect((await call(strict, jar, 'POST', '/api/v1/auth/refresh')).statusCode).toBe(204);

    const replay = await strict.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { rl_rt: stolen },
    });
    expect(replay.statusCode).toBe(401);
    // the legitimate user's fresh tokens are dead as well
    expect((await call(strict, jar, 'POST', '/api/v1/auth/refresh')).statusCode).toBe(401);
    expect((await call(strict, new Jar(), 'GET', '/api/v1/me')).statusCode).toBe(401);
    const meWithOldAccess = await strict.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { rl_at: jar.cookies.rl_at ?? '' },
    });
    expect(meWithOldAccess.statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('answers 409 (not theft) when two tabs refresh with the same token at once', async () => {
    const { jar } = await register(app);
    const shared = jar.cookies.rl_rt!;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { rl_rt: shared },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { rl_rt: shared },
    });
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(409);
    expect(setCookies(second)).toEqual([]); // must not clear the new cookies
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('401 and clears cookies for a missing or bogus refresh token', async () => {
    const none = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: CSRF });
    expect(none.statusCode).toBe(401);
    const bogus = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { rl_rt: 'bogus' },
    });
    expect(bogus.statusCode).toBe(401);
    expect(
      setCookies(bogus)
        .map((c) => c.name)
        .sort(),
    ).toEqual(['rl_at', 'rl_rt']);
  });
});

describe('logout (AUTH-4)', () => {
  it('revokes the refresh token, clears cookies and kills the access token immediately', async () => {
    const { jar } = await register(app);
    const access = jar.cookies.rl_at!;
    const refresh = jar.cookies.rl_rt!;
    const res = await call(app, jar, 'POST', '/api/v1/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(setCookies(res).every((c) => c.attrs['max-age'] === '0' || c.value === '')).toBe(true);
    expect(jar.cookies).toEqual({});

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: CSRF,
      cookies: { rl_rt: refresh },
    });
    expect(reuse.statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', cookies: { rl_at: access } });
    expect(me.statusCode).toBe(401);
  });

  it('is idempotent without cookies', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: CSRF });
    expect(res.statusCode).toBe(204);
  });

  it('logout-all ends every session of the user', async () => {
    await register(app);
    const a = await login(app, 'alice');
    const b = await login(app, 'alice');
    const res = await call(app, a.jar, 'POST', '/api/v1/auth/logout-all');
    expect(res.statusCode).toBe(204);
    expect((await call(app, b.jar, 'GET', '/api/v1/me')).statusCode).toBe(401);
    expect((await call(app, b.jar, 'POST', '/api/v1/auth/refresh')).statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });
});

describe('password & sessions (AUTH-6)', () => {
  it('changes the password, keeps this session and revokes the others', async () => {
    const { jar: current } = await register(app);
    const other = await login(app, 'alice');
    const wrong = await call(app, current, 'POST', '/api/v1/me/password', {
      currentPassword: 'nope nope nope',
      newPassword: 'a brand new passphrase',
    });
    expect(wrong.statusCode).toBe(401);
    const breached = await call(app, current, 'POST', '/api/v1/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'password1234',
    });
    expect(breached.statusCode).toBe(400);

    const ok = await call(app, current, 'POST', '/api/v1/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'a brand new passphrase',
    });
    expect(ok.statusCode).toBe(204);
    expect((await call(app, current, 'GET', '/api/v1/me')).statusCode).toBe(200);
    expect((await call(app, other.jar, 'GET', '/api/v1/me')).statusCode).toBe(401);
    expect((await login(app, 'alice')).res.statusCode).toBe(401);
    expect((await login(app, 'alice', 'a brand new passphrase')).res.statusCode).toBe(200);
  });

  it('lists sessions with the current one marked, and revokes another', async () => {
    const { jar } = await register(app);
    const other = await login(app, 'alice');
    const list = await call(app, jar, 'GET', '/api/v1/me/sessions');
    const items = list.json<{ items: { id: string; current: boolean }[] }>().items;
    expect(items).toHaveLength(2);
    expect(items.filter((s) => s.current)).toHaveLength(1);
    const target = items.find((s) => !s.current)!;

    expect((await call(app, jar, 'DELETE', `/api/v1/me/sessions/${target.id}`)).statusCode).toBe(
      204,
    );
    expect((await call(app, other.jar, 'GET', '/api/v1/me')).statusCode).toBe(401);

    // someone else's session id → 404
    const { jar: bob } = await register(app, undefined, {
      email: 'bob@example.com',
      username: 'bob',
    });
    expect((await call(app, bob, 'DELETE', `/api/v1/me/sessions/${items[0]!.id}`)).statusCode).toBe(
      404,
    );
  });
});

describe('username availability', () => {
  it('reports taken, free and invalid names', async () => {
    await register(app);
    const q = async (u: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/auth/username-available?u=${encodeURIComponent(u)}`,
        })
      ).json<{ available: boolean }>();
    expect(await q('ALICE')).toEqual({ available: false });
    expect(await q('bob_2')).toEqual({ available: true });
    expect(await q('no spaces')).toEqual({ available: false });
  });
});
