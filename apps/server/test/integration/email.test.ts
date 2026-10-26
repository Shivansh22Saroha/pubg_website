import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { createMemoryMailer } from '../../src/lib/mailer.js';
import { hashEmailToken } from '../../src/modules/auth/emailTokens.js';
import {
  CSRF,
  call,
  Jar,
  login,
  makeApp,
  PASSWORD,
  prisma,
  register,
  sleep,
  useCleanState,
} from './harness.js';

/** Email verification & password reset behind EMAIL_ENABLED (AUTH-7, SECURITY A9). */

useCleanState();

const mailer = createMemoryMailer();
let app: App;
let off: App;
beforeAll(async () => {
  ({ app } = await makeApp(
    { RATE_LIMITS_ENABLED: 'false', EMAIL_ENABLED: 'true', SMTP_HOST: 'smtp.invalid' },
    { mailer },
  ));
  ({ app: off } = await makeApp({ RATE_LIMITS_ENABLED: 'false', EMAIL_ENABLED: 'false' }));
});

const post = (a: App, url: string, payload: object) =>
  a.inject({ method: 'POST', url, headers: CSRF, payload });

/** the token from the newest mail to `to` (the link's ?token=) */
async function tokenFor(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const mail = [...mailer.sent].reverse().find((m) => m.to === to);
    const match = mail?.text.match(/token=([A-Za-z0-9_-]{43})/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    await sleep(25);
  }
  throw new Error(`no mail for ${to}`);
}

describe('verify email', () => {
  it('register sends a verification mail; the link verifies once', async () => {
    mailer.sent.length = 0;
    const { jar } = await register(app, new Jar(), { email: 'ana@example.com', username: 'ana' });
    const token = await tokenFor('ana@example.com');
    const mail = mailer.sent.find((m) => m.to === 'ana@example.com')!;
    expect(mail.subject).toMatch(/Verify your email/);
    expect(mail.text).toContain(`/verify-email?token=${token}`);
    // stored hashed only
    expect(await prisma.emailToken.count({ where: { tokenHash: token } })).toBe(0);
    expect(
      await prisma.emailToken.count({
        where: { tokenHash: hashEmailToken(token), purpose: 'verify' },
      }),
    ).toBe(1);

    expect((await post(app, '/api/v1/auth/verify-email', { token })).statusCode).toBe(204);
    expect(
      (await call(app, jar, 'GET', '/api/v1/me')).json<{ user: { emailVerified: boolean } }>().user
        .emailVerified,
    ).toBe(true);
    // reused → generic 400
    const again = await post(app, '/api/v1/auth/verify-email', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json<{ error: { message: string } }>().error.message).toBe(
      'This link is invalid or has expired',
    );
  });

  it('expired, wrong-purpose, unknown and malformed tokens all fail the same way', async () => {
    const { jar } = await register(app, new Jar(), { email: 'bo@example.com', username: 'bob' });
    const verify = await tokenFor('bo@example.com');
    // a reset token can't verify, a verify token can't reset
    await post(app, '/api/v1/auth/forgot-password', { email: 'bo@example.com' });
    await sleep(50);
    const reset = await tokenFor('bo@example.com');
    expect(reset).not.toBe(verify);
    expect((await post(app, '/api/v1/auth/verify-email', { token: reset })).statusCode).toBe(400);
    expect(
      (
        await post(app, '/api/v1/auth/reset-password', {
          token: verify,
          password: 'a brand new password',
        })
      ).statusCode,
    ).toBe(400);
    // expired
    await prisma.emailToken.updateMany({
      where: { tokenHash: hashEmailToken(verify) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await post(app, '/api/v1/auth/verify-email', { token: verify })).statusCode).toBe(400);
    expect(
      (await post(app, '/api/v1/auth/verify-email', { token: 'A'.repeat(43) })).statusCode,
    ).toBe(400);
    expect((await post(app, '/api/v1/auth/verify-email', { token: 'short' })).statusCode).toBe(400);
    // resend issues a fresh link and voids the old one
    expect((await call(app, jar, 'POST', '/api/v1/auth/resend-verification')).statusCode).toBe(202);
    await sleep(50);
    const fresh = await tokenFor('bo@example.com');
    expect((await post(app, '/api/v1/auth/verify-email', { token: fresh })).statusCode).toBe(204);
  });
});

describe('forgot / reset password', () => {
  it('forgot-password answers 202 identically for known and unknown emails (no enumeration)', async () => {
    await register(app, new Jar(), { email: 'cy@example.com', username: 'cyd' });
    await sleep(50);
    mailer.sent.length = 0;
    const known = await post(app, '/api/v1/auth/forgot-password', { email: 'cy@example.com' });
    const unknown = await post(app, '/api/v1/auth/forgot-password', {
      email: 'nobody@example.com',
    });
    expect([known.statusCode, unknown.statusCode]).toEqual([202, 202]);
    expect(known.body).toBe(unknown.body);
    await sleep(100);
    expect(mailer.sent.map((m) => m.to)).toEqual(['cy@example.com']);
  });

  it('reset: new password works, every session is revoked, the link is single-use, a weak password doesn’t burn it', async () => {
    const { jar } = await register(app, new Jar(), { email: 'di@example.com', username: 'dil' });
    const other = await login(app, 'dil');
    await post(app, '/api/v1/auth/forgot-password', { email: 'di@example.com' });
    await sleep(50);
    const token = await tokenFor('di@example.com');

    const weak = await post(app, '/api/v1/auth/reset-password', { token, password: 'short' });
    expect(weak.statusCode).toBe(400);
    const ok = await post(app, '/api/v1/auth/reset-password', {
      token,
      password: 'a completely new passphrase',
    });
    expect(ok.statusCode, ok.body).toBe(204);
    for (const j of [jar, other.jar]) {
      expect((await call(app, j, 'GET', '/api/v1/me')).statusCode).toBe(401);
      expect((await call(app, j, 'POST', '/api/v1/auth/refresh')).statusCode).toBe(401);
    }
    expect((await login(app, 'dil', PASSWORD)).res.statusCode).toBe(401);
    expect((await login(app, 'dil', 'a completely new passphrase')).res.statusCode).toBe(200);
    expect(
      (
        await post(app, '/api/v1/auth/reset-password', {
          token,
          password: 'yet another passphrase',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('a newer reset link voids the older one; reset links expire after 30 min', async () => {
    await register(app, new Jar(), { email: 'ed@example.com', username: 'eddy' });
    await post(app, '/api/v1/auth/forgot-password', { email: 'ed@example.com' });
    await sleep(50);
    const first = await tokenFor('ed@example.com');
    await post(app, '/api/v1/auth/forgot-password', { email: 'ed@example.com' });
    await sleep(50);
    const second = await tokenFor('ed@example.com');
    expect(
      (
        await post(app, '/api/v1/auth/reset-password', {
          token: first,
          password: 'passphrase number one',
        })
      ).statusCode,
    ).toBe(400);
    const row = await prisma.emailToken.findUniqueOrThrow({
      where: { tokenHash: hashEmailToken(second) },
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(
      30 * 60_000 + 1000,
    );
    expect(
      (
        await post(app, '/api/v1/auth/reset-password', {
          token: second,
          password: 'passphrase number two',
        })
      ).statusCode,
    ).toBe(204);
  });
});

describe('EMAIL_ENABLED=false', () => {
  it('every email route is a 404 and registering sends nothing; /config says so', async () => {
    const before = mailer.sent.length;
    const { jar } = await register(off, new Jar(), { email: 'fi@example.com', username: 'fin' });
    for (const [url, payload] of [
      ['/api/v1/auth/verify-email', { token: 'A'.repeat(43) }],
      ['/api/v1/auth/forgot-password', { email: 'fi@example.com' }],
      ['/api/v1/auth/reset-password', { token: 'A'.repeat(43), password: 'whatever passphrase' }],
    ] as const)
      expect((await post(off, url, payload)).statusCode, url).toBe(404);
    expect((await call(off, jar, 'POST', '/api/v1/auth/resend-verification')).statusCode).toBe(404);
    expect(mailer.sent.length).toBe(before);
    expect((await off.inject({ method: 'GET', url: '/api/v1/config' })).json()).toEqual({
      emailEnabled: false,
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json()).toEqual({
      emailEnabled: true,
    });
  });
});
