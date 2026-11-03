import { env } from '@/env';
import { sentryOptions } from '@/lib/sentryOptions';

// The SDK is a separate chunk, fetched only when a DSN is configured: pages without Sentry pay
// nothing, and its CSP host is allowed by src/lib/csp.ts.
const dsn = env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => Sentry.init(sentryOptions(dsn)));
}
