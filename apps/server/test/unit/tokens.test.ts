import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { createTokenService } from '../../src/modules/auth/tokens.js';

const base = {
  secret: 'a'.repeat(48),
  issuer: 'rotationlab',
  audience: 'rotationlab-web',
  ttlSec: 900,
};
const claims = {
  sub: '0192f7a1-0000-7000-8000-000000000001',
  sid: '0192f7a1-0000-7000-8000-000000000002',
};

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : 'other';
  }
}

describe('token service (SECURITY A3)', () => {
  it('signs HS256 with exactly sub, sid, iss, aud, iat, exp — no roles', async () => {
    const svc = createTokenService(base);
    const jwt = await svc.sign(claims);
    expect(decodeProtectedHeader(jwt).alg).toBe('HS256');
    const payload = decodeJwt(jwt);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
    expect(payload.exp! - payload.iat!).toBe(900);
    expect(await svc.verify(jwt)).toEqual({ ...claims, exp: payload.exp });
  });

  it('maps an expired token to TOKEN_EXPIRED', async () => {
    let t = Date.now();
    const svc = createTokenService(base, () => t);
    const jwt = await svc.sign(claims);
    t += 901_000;
    expect(await codeOf(svc.verify(jwt))).toBe('TOKEN_EXPIRED');
  });

  it('rejects wrong audience, wrong issuer, wrong secret and garbage as UNAUTHENTICATED', async () => {
    const svc = createTokenService(base);
    const wrongAud = await createTokenService({ ...base, audience: 'other' }).sign(claims);
    const wrongIss = await createTokenService({ ...base, issuer: 'evil' }).sign(claims);
    const wrongKey = await createTokenService({ ...base, secret: 'b'.repeat(48) }).sign(claims);
    for (const t of [wrongAud, wrongIss, wrongKey, 'not.a.jwt', '']) {
      expect(await codeOf(svc.verify(t))).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects alg=none and tokens missing sid', async () => {
    const svc = createTokenService(base);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: claims.sub, sid: claims.sid, iss: base.issuer, aud: base.audience }),
    ).toString('base64url')}.`;
    expect(await codeOf(svc.verify(none))).toBe('UNAUTHENTICATED');

    const noSid = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(base.issuer)
      .setAudience(base.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(base.secret));
    expect(await codeOf(svc.verify(noSid))).toBe('UNAUTHENTICATED');
  });

  it('accepts JWT_SECRET_PREVIOUS for verification during rotation, never for signing', async () => {
    const old = createTokenService({ ...base, secret: 'o'.repeat(48) });
    const oldJwt = await old.sign(claims);
    const rotated = createTokenService({
      ...base,
      secret: 'n'.repeat(48),
      previousSecret: 'o'.repeat(48),
    });
    expect(await rotated.verify(oldJwt)).toMatchObject(claims);
    // new tokens are signed with the new secret only
    const fresh = await rotated.sign(claims);
    expect(await codeOf(old.verify(fresh))).toBe('UNAUTHENTICATED');
    // without the previous secret configured the old token is rejected
    const noPrev = createTokenService({ ...base, secret: 'n'.repeat(48) });
    expect(await codeOf(noPrev.verify(oldJwt))).toBe('UNAUTHENTICATED');
  });
});
