import type { Instrumentation } from 'next';

/** Next server errors (render, route handlers, proxy) → Sentry, when a DSN is configured. */
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [Sentry, { sentryOptions }] = await Promise.all([
    import('@sentry/nextjs'),
    import('@/lib/sentryOptions'),
  ]);
  Sentry.init(sentryOptions(dsn));
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
