import { AUTH_COOKIES } from '@rotationlab/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface CookieConfig {
  secure: boolean;
  domain?: string | undefined;
  accessTtlSec: number;
  refreshTtlDays: number;
}

/**
 * API_SPEC §1.1 / SECURITY A5. With COOKIE_SECURE the access cookie gets the `__Host-` prefix
 * (Secure, Path=/, no Domain) and the refresh cookie `__Secure-` (its Path is not `/`, so
 * `__Host-` is impossible). Plain names in dev over http.
 */
export function createAuthCookies(cfg: CookieConfig) {
  const accessName = cfg.secure ? AUTH_COOKIES.accessSecure : AUTH_COOKIES.access;
  const refreshName = cfg.secure ? AUTH_COOKIES.refreshSecure : AUTH_COOKIES.refresh;
  const domain = cfg.secure ? undefined : cfg.domain;

  const access: CookieSerializeOptions = {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
  const refresh: CookieSerializeOptions = {
    httpOnly: true,
    secure: cfg.secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };

  return {
    accessName,
    refreshName,
    set(reply: FastifyReply, tokens: { access: string; refresh: string }) {
      reply.setCookie(accessName, tokens.access, { ...access, maxAge: cfg.accessTtlSec });
      reply.setCookie(refreshName, tokens.refresh, {
        ...refresh,
        maxAge: cfg.refreshTtlDays * 24 * 3600,
      });
    },
    clear(reply: FastifyReply) {
      reply.clearCookie(accessName, access);
      reply.clearCookie(refreshName, refresh);
    },
    readAccess: (req: FastifyRequest) => req.cookies[accessName],
    readRefresh: (req: FastifyRequest) => req.cookies[refreshName],
  };
}
export type AuthCookies = ReturnType<typeof createAuthCookies>;
