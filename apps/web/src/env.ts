// first: the shared package's Zod setup (jitless in browsers) must run before PublicEnvSchema is built
import '@rotationlab/shared';
import { z } from 'zod';

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_ORIGIN: z.url(),
  NEXT_PUBLIC_API_BASE: z.string().startsWith('/'),
  NEXT_PUBLIC_SOCKET_PATH: z.string().startsWith('/'),
  NEXT_PUBLIC_TILES_BASE_URL: z.string().min(1),
  NEXT_PUBLIC_SOCKET_URL: z.url().optional(),
  /** error reports (Phase 10); unset → Sentry stays off */
  NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  /** Sentry environment tag (production / staging) */
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().min(1).optional(),
});

// NEXT_PUBLIC_* must be referenced literally so Next can inline them at build time.
export const env = PublicEnvSchema.parse({
  NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN,
  NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE,
  NEXT_PUBLIC_SOCKET_PATH: process.env.NEXT_PUBLIC_SOCKET_PATH,
  NEXT_PUBLIC_TILES_BASE_URL: process.env.NEXT_PUBLIC_TILES_BASE_URL,
  NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || undefined,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
});
