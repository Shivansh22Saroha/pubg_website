import { AUTH_COOKIES } from '@rotationlab/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/env';
import { buildCsp } from '@/lib/csp';

const APP_AREA = /^\/(dashboard|rooms|settings)(\/|$)/;

/**
 * Next 16 "proxy" (formerly middleware), on every page request:
 * 1. CSP with a per-request nonce (SECURITY §5 T4). Set on the request too: Next reads the
 *    nonce from it while rendering and stamps it on its scripts.
 * 2. Route guard for the (app) area. UX only: it checks that an access cookie is present; the
 *    API verifies every request. With no cookie we send the user to /login, which first tries a
 *    silent refresh (the refresh cookie is scoped to /api/v1/auth, so it is invisible here) and
 *    comes straight back if the session is alive.
 */
export function proxy(request: NextRequest) {
  if (APP_AREA.test(request.nextUrl.pathname)) {
    const hasAccess =
      request.cookies.has(AUTH_COOKIES.access) || request.cookies.has(AUTH_COOKIES.accessSecure);
    if (!hasAccess) {
      const login = new URL('/login', request.url);
      login.searchParams.set('redirectTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
  }

  const csp = buildCsp({
    nonce: Buffer.from(crypto.randomUUID()).toString('base64'),
    dev: process.env.NODE_ENV === 'development',
    tilesBaseUrl: env.NEXT_PUBLIC_TILES_BASE_URL,
    socketUrl: env.NEXT_PUBLIC_SOCKET_URL,
    sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN,
    // server-only, read per request: where the API stores board thumbnails when on R2 / S3
    assetsBaseUrl: process.env.PUBLIC_ASSETS_BASE_URL,
  });
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the API / socket (Caddy or the dev rewrite), static chunks, tiles or
      // public files (anything with an extension)
      source: '/((?!api/|realtime/|_next/static|_next/image|tiles/|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
