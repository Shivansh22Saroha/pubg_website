import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { AppError } from '../../lib/errors.js';

export interface TokenConfig {
  secret: string;
  previousSecret?: string | undefined;
  issuer: string;
  audience: string;
  ttlSec: number;
}

export interface AccessClaims {
  /** user id */
  sub: string;
  /** session id = refresh-token family id */
  sid: string;
}

const ALG = 'HS256';
const key = (secret: string) => new TextEncoder().encode(secret);

/**
 * Access tokens (SECURITY A3): HS256, claims { sub, sid, iat, exp, iss, aud } only — no roles,
 * those are looked up per request. JWT_SECRET_PREVIOUS is accepted for verification only.
 */
export function createTokenService(cfg: TokenConfig, now: () => number = Date.now) {
  const current = key(cfg.secret);
  const previous = cfg.previousSecret ? key(cfg.previousSecret) : undefined;

  async function verifyWith(token: string, secret: Uint8Array) {
    return jwtVerify(token, secret, {
      algorithms: [ALG],
      issuer: cfg.issuer,
      audience: cfg.audience,
      currentDate: new Date(now()),
      requiredClaims: ['sub', 'sid', 'iat', 'exp'],
    });
  }

  return {
    async sign(claims: AccessClaims): Promise<string> {
      const iat = Math.floor(now() / 1000);
      return new SignJWT({ sid: claims.sid })
        .setProtectedHeader({ alg: ALG, typ: 'JWT' })
        .setSubject(claims.sub)
        .setIssuer(cfg.issuer)
        .setAudience(cfg.audience)
        .setIssuedAt(iat)
        .setExpirationTime(iat + cfg.ttlSec)
        .sign(current);
    },

    /** Throws AppError TOKEN_EXPIRED or UNAUTHENTICATED. */
    async verify(token: string): Promise<AccessClaims> {
      let payload: JWTPayload;
      try {
        ({ payload } = await verifyWith(token, current));
      } catch (err) {
        if (err instanceof errors.JWSSignatureVerificationFailed && previous) {
          try {
            ({ payload } = await verifyWith(token, previous));
          } catch (prevErr) {
            throw mapError(prevErr);
          }
        } else {
          throw mapError(err);
        }
      }
      const { sub, sid } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string') {
        throw new AppError('UNAUTHENTICATED', 'Invalid access token');
      }
      return { sub, sid };
    },
  };
}
export type TokenService = ReturnType<typeof createTokenService>;

function mapError(err: unknown): AppError {
  if (err instanceof errors.JWTExpired)
    return new AppError('TOKEN_EXPIRED', 'Access token expired');
  return new AppError('UNAUTHENTICATED', 'Invalid access token');
}
