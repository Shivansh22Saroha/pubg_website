import { env } from '@/env';

/**
 * Sentry for the web app (DEPLOYMENT §7), shared by the browser (instrumentation-client.ts) and
 * the Next server (instrumentation.ts). Errors only — no tracing or replay — and none of the
 * data Sentry 11 collects by default (cookies, headers, bodies, query strings, user info).
 */
export function sentryOptions(dsn: string) {
  return {
    dsn,
    release: `rotationlab-web@${process.env.NEXT_PUBLIC_RELEASE ?? 'dev'}`,
    environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  };
}
