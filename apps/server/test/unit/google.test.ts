import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  createGoogleClient,
  pkceChallenge,
  safeNext,
  usernameSeed,
} from '../../src/modules/auth/google.js';

const CLIENT = 'client-123.apps.googleusercontent.com';

async function setup(claims: Record<string, unknown>, opts: { iss?: string; aud?: string } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const idToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? 'https://accounts.google.com')
    .setAudience(opts.aud ?? CLIENT)
    .setSubject('sub-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  const calls: URLSearchParams[] = [];
  const client = createGoogleClient({
    clientId: CLIENT,
    clientSecret: 'secret',
    redirectUri: 'https://app.example/api/v1/auth/google/callback',
    keys: createLocalJWKSet({ keys: [jwk] }),
    fetch: (async (_url: string, init: RequestInit) => {
      calls.push(new URLSearchParams(init.body as string));
      return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { client, calls };
}

describe('Google OAuth client', () => {
  it('builds the consent URL: code flow, PKCE S256, nonce, minimal scopes', () => {
    const c = createGoogleClient({
      clientId: CLIENT,
      clientSecret: 's',
      redirectUri: 'https://a/cb',
    });
    const u = new URL(c.authUrl({ state: 'st', challenge: 'ch', nonce: 'no' }));
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('https://a/cb');
    expect(u.searchParams.get('nonce')).toBe('no');
  });

  it('exchanges the code (with the PKCE verifier) and returns the verified profile', async () => {
    const { client, calls } = await setup({
      nonce: 'n1',
      email: 'Shiva@Gmail.com',
      email_verified: true,
      name: 'Shiva',
    });
    const p = await client.exchange({ code: 'c', verifier: 'v', nonce: 'n1' });
    expect(p).toEqual({
      sub: 'sub-1',
      email: 'shiva@gmail.com',
      emailVerified: true,
      name: 'Shiva',
    });
    expect(calls[0]?.get('code_verifier')).toBe('v');
    expect(calls[0]?.get('grant_type')).toBe('authorization_code');
  });

  it('rejects a wrong nonce, audience or issuer', async () => {
    const bad = [
      await setup({ nonce: 'other', email: 'a@b.c', email_verified: true }),
      await setup({ nonce: 'n1', email: 'a@b.c' }, { aud: 'someone-else' }),
      await setup({ nonce: 'n1', email: 'a@b.c' }, { iss: 'https://evil.example' }),
    ];
    for (const { client } of bad) {
      await expect(client.exchange({ code: 'c', verifier: 'v', nonce: 'n1' })).rejects.toThrow();
    }
  });

  it('reports an unverified email as such (the caller refuses to link it)', async () => {
    const { client } = await setup({ nonce: 'n1', email: 'a@b.c', email_verified: false });
    expect((await client.exchange({ code: 'c', verifier: 'v', nonce: 'n1' })).emailVerified).toBe(
      false,
    );
  });
});

describe('helpers', () => {
  it('PKCE S256 challenge (RFC 7636 appendix B)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('usernames from the email, fitting the username rules', () => {
    expect(usernameSeed('Shiva.S+bgmi@gmail.com', null)).toBe('shiva_s_bgmi');
    expect(usernameSeed('ab@x.io', 'Rudra Kumar')).toBe('rudra_kumar');
    expect(usernameSeed('a@x.io', null)).toBe('player');
    expect(usernameSeed('averyveryverylongemailname@x.io', null)).toHaveLength(16);
  });
  it('next: own paths only', () => {
    expect(safeNext('/rooms/1')).toBe('/rooms/1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', undefined, 42])
      expect(safeNext(bad)).toBe('/dashboard');
  });
});
