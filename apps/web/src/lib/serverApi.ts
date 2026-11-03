import { AUTH_COOKIES } from '@rotationlab/shared';
import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { cookies, headers } from 'next/headers';
import type { z } from 'zod';
import { serverEnv } from './serverEnv';

/** a slow API must not hold the page: past this the client fetches as before */
const PREFETCH_TIMEOUT_MS = 1500;

export interface PrefetchContext {
  baseUrl: string;
  /** the request's access cookie(s), as a Cookie header; empty → nothing to fetch */
  cookie: string;
  /** client IP chain from the reverse proxy, so the API's per-IP limits see the user, not us */
  forwardedFor: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * GET an API route on behalf of the incoming request (ARCHITECTURE §1, server-rendered
 * dashboard). Returns null on anything but a valid 200 — expired token, API down, timeout,
 * schema mismatch — and the page then loads on the client exactly as without it (where a 401
 * gets the silent refresh this can't do: the refresh cookie is scoped to /api/v1/auth).
 */
export async function prefetchApi<S extends z.ZodType>(
  path: string,
  schema: S,
  ctx: PrefetchContext,
): Promise<z.infer<S> | null> {
  if (!ctx.cookie) return null;
  try {
    const res = await (ctx.fetchImpl ?? fetch)(`${ctx.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
      cache: 'no-store',
      headers: {
        cookie: ctx.cookie,
        ...(ctx.forwardedFor ? { 'x-forwarded-for': ctx.forwardedFor } : {}),
      },
      signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Only the access cookie goes to the API — not every cookie the browser sent us. */
export async function requestContext(): Promise<PrefetchContext> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const cookie = [AUTH_COOKIES.access, AUTH_COOKIES.accessSecure]
    .flatMap((name) => {
      const c = jar.get(name);
      return c ? [`${name}=${c.value}`] : [];
    })
    .join('; ');
  return {
    baseUrl: serverEnv().INTERNAL_API_URL,
    cookie,
    forwardedFor: h.get('x-forwarded-for'),
  };
}

/** Cache entries for a `HydrationBoundary`; entries whose fetch failed are left out. */
export function dehydrated(entries: [key: readonly unknown[], data: unknown][]): DehydratedState {
  const client = new QueryClient();
  for (const [key, data] of entries) if (data != null) client.setQueryData(key, data);
  return dehydrate(client);
}
