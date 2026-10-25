import { AUTH_COOKIES } from '@rotationlab/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route guard for the (app) area (Next 16 "proxy", formerly middleware). UX only: it checks
 * that an access cookie is present; the API verifies every request. With no cookie we send the
 * user to /login, which first tries a silent refresh (the refresh cookie is scoped to
 * /api/v1/auth, so it is invisible here) and comes straight back if the session is alive.
 */
export function proxy(request: NextRequest) {
  const hasAccess =
    request.cookies.has(AUTH_COOKIES.access) || request.cookies.has(AUTH_COOKIES.accessSecure);
  if (hasAccess) return NextResponse.next();

  const login = new URL('/login', request.url);
  login.searchParams.set('redirectTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard/:path*', '/rooms/:path*', '/settings/:path*'],
};
