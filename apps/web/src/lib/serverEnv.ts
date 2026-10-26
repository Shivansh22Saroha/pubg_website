import { z } from 'zod';

/**
 * Server-only web settings (ENVIRONMENT §2; import only from server components / route
 * handlers), read at request time — never `NEXT_PUBLIC_*`, so
 * they can change without a rebuild and never reach the browser.
 */
const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** `/maps/[mapId]` dev viewer; default: on outside production */
  ENABLE_DEV_PAGES: z.enum(['true', 'false']).optional(),
  /** `/.well-known/security.txt` Contact (SECURITY §13): `mailto:` or `https:` URL */
  SECURITY_CONTACT: z
    .string()
    .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, 'mailto: or https: URL')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function serverEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return ServerEnvSchema.parse({
    NODE_ENV: source.NODE_ENV,
    ENABLE_DEV_PAGES: source.ENABLE_DEV_PAGES || undefined,
    SECURITY_CONTACT: source.SECURITY_CONTACT,
  });
}

/** TODO.md Phase 9: the dev map viewer is off in production unless ENABLE_DEV_PAGES=true. */
export function devPagesEnabled(env: Pick<ServerEnv, 'NODE_ENV' | 'ENABLE_DEV_PAGES'>): boolean {
  return env.ENABLE_DEV_PAGES === undefined
    ? env.NODE_ENV !== 'production'
    : env.ENABLE_DEV_PAGES === 'true';
}
