import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../../lib/errors.js';

/**
 * Sign in with Google (FEATURES F17, SECURITY A12): OAuth 2.0 authorization-code flow with
 * PKCE (S256), `state` bound to the browser by a cookie, and an OIDC `nonce`. The ID token is
 * verified against Google's published keys (issuer, audience = our client id, expiry, nonce).
 * Only `openid email profile` is requested — no access to anything else in the account.
 */
export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export interface GoogleClient {
  /** the URL to send the browser to */
  authUrl(p: { state: string; challenge: string; nonce: string }): string;
  /** trade the callback's code for a verified profile */
  exchange(p: { code: string; verifier: string; nonce: string }): Promise<GoogleProfile>;
}

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

export const b64url = (buf: Buffer) => buf.toString('base64url');
export const randomToken = () => b64url(randomBytes(32));
export const pkceChallenge = (verifier: string) =>
  b64url(createHash('sha256').update(verifier).digest());

export function createGoogleClient(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** tests: a stub token endpoint and local keys */
  fetch?: typeof fetch;
  keys?: JWTVerifyGetKey;
}): GoogleClient {
  const doFetch = opts.fetch ?? fetch;
  const keys = opts.keys ?? createRemoteJWKSet(new URL(CERTS));
  return {
    authUrl({ state, challenge, nonce }) {
      const q = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
        access_type: 'online',
      });
      return `${AUTH_ENDPOINT}?${q.toString()}`;
    },

    async exchange({ code, verifier, nonce }) {
      const res = await doFetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: opts.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new AppError('UNAUTHENTICATED', 'Google sign-in failed');
      const body = (await res.json()) as { id_token?: unknown };
      if (typeof body.id_token !== 'string') {
        throw new AppError('UNAUTHENTICATED', 'Google sign-in failed');
      }
      const { payload } = await jwtVerify(body.id_token, keys, {
        issuer: GOOGLE_ISSUERS,
        audience: opts.clientId,
        clockTolerance: 30,
      }).catch(() => {
        throw new AppError('UNAUTHENTICATED', 'Google sign-in failed');
      });
      if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) {
        throw new AppError('UNAUTHENTICATED', 'Google sign-in failed');
      }
      if (typeof payload.email !== 'string' || !payload.email) {
        throw new AppError('UNAUTHENTICATED', 'Your Google account has no email address');
      }
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === 'string' ? payload.name : null,
      };
    },
  };
}

/** "Shiva.S+bgmi@gmail.com" → "shiva_s_bgmi" (fits USERNAME_PATTERN, ≤ 16 chars to leave room) */
export function usernameSeed(email: string, name: string | null): string {
  const pick = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16);
  const fromEmail = pick(email.split('@')[0] ?? '');
  const seed = fromEmail.length >= 3 ? fromEmail : pick(name ?? '');
  return seed.length >= 3 ? seed : 'player';
}

/** where to land after sign-in: our own paths only (no open redirect) */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) {
    return '/dashboard';
  }
  if (next.includes('\\') || next.length > 200) return '/dashboard';
  return next;
}
