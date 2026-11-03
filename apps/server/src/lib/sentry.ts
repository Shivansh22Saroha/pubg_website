import * as Sentry from '@sentry/node';
import type { Config } from '../config.js';
import { VERSION } from './version.js';

/**
 * Error tracking (DEPLOYMENT §7), off unless SENTRY_DSN is set. Only unexpected 5xx errors are
 * reported (errorHandler.ts); no tracing, no PII: cookies, headers, bodies and query strings are
 * never collected, and stripped again before sending (SECURITY §7 — never ship tokens or chat text off the box).
 */
export function initSentry(config: Pick<Config, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'NODE_ENV'>) {
  if (!config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    release: `rotationlab-server@${VERSION}`,
    environment: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV,
    // Sentry 11 collects cookies, headers, bodies and user info by default — none of it here
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.headers;
        delete event.request.query_string;
      }
      return event;
    },
  });
}

/** No-op when Sentry was never initialised. */
export function reportError(err: unknown, requestId?: string) {
  Sentry.captureException(err, requestId ? { tags: { requestId } } : undefined);
}
