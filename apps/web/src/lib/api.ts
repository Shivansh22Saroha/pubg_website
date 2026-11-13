import {
  ApiErrorBodySchema,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type ApiErrorDetail,
  type ErrorCode,
} from '@rotationlab/shared';
import type { z } from 'zod';
import { markWaking, trackSlow } from './slowRequests';

const API_BASE = '/api/v1'; // same origin in every environment (ARCHITECTURE §1)

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions<S extends z.ZodType | undefined> {
  method?: Method;
  body?: unknown;
  /** response schema; omit for 204 responses */
  schema?: S;
  /** a binary body sent as-is (e.g. a thumbnail JPEG) instead of JSON `body` */
  raw?: { data: Blob; type: string };
  signal?: AbortSignal;
}

type Result<S> = S extends z.ZodType ? z.infer<S> : undefined;

function send(
  path: string,
  method: Method,
  body: unknown,
  signal?: AbortSignal,
  raw?: { data: Blob; type: string },
) {
  const json = body !== undefined && !raw;
  return trackSlow(
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include', // httpOnly cookies only — no tokens in JS, storage or URLs
      cache: 'no-store',
      headers: {
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
        ...(raw
          ? { 'content-type': raw.type }
          : json
            ? { 'content-type': 'application/json' }
            : {}),
      },
      ...(raw ? { body: raw.data } : json ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    }),
  );
}

async function toError(res: Response): Promise<ApiError> {
  const parsed = ApiErrorBodySchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return new ApiError(res.status, 'INTERNAL', `HTTP ${res.status}`);
  const { code, message, details } = parsed.data.error;
  return new ApiError(res.status, code, message, details);
}

/** how long a request keeps retrying while the API boots (Render free plan: ~30–60 s) */
export const WAKE_MAX_MS = 90_000;
const WAKE_DELAYS_MS = [1000, 2000, 3000, 4000, 5000];

/**
 * The host, not our API, answered: while a sleeping free-tier instance boots, the proxy returns
 * 502/503/504 with an HTML page. Our own errors are always JSON, so they never match — and a
 * request that got this answer never reached the API, so retrying any method is safe.
 */
export function isWakingResponse(res: Response): boolean {
  if (res.status !== 502 && res.status !== 503 && res.status !== 504) return false;
  return !(res.headers.get('content-type') ?? '').includes('application/json');
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** send(), retried with backoff while the API is booting; shows the "waking" card meanwhile */
async function sendAwake(
  path: string,
  method: Method,
  body: unknown,
  signal?: AbortSignal,
  raw?: { data: Blob; type: string },
): Promise<Response> {
  let res = await send(path, method, body, signal, raw);
  if (!isWakingResponse(res)) return res;
  const done = markWaking();
  try {
    const started = Date.now();
    for (let i = 0; isWakingResponse(res) && Date.now() - started < WAKE_MAX_MS; i++) {
      await pause(WAKE_DELAYS_MS[Math.min(i, WAKE_DELAYS_MS.length - 1)] ?? 5000, signal);
      res = await send(path, method, body, signal, raw);
    }
    return res;
  } finally {
    done();
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * POST /auth/refresh, shared by every caller that hits a 401 at the same time (one network
 * call). 409 means another tab refreshed a moment ago — its new cookies are already set.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= sendAwake('/auth/refresh', 'POST', undefined)
    .then((res) => res.status === 204 || res.status === 409)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Typed API call. On a 401 it refreshes the session once and retries. Both TOKEN_EXPIRED and
 * UNAUTHENTICATED trigger it: the access cookie's Max-Age equals the JWT lifetime, so after
 * expiry the browser usually sends no cookie at all and the server can only say UNAUTHENTICATED.
 */
export async function api<S extends z.ZodType | undefined = undefined>(
  path: string,
  opts: RequestOptions<S> = {},
): Promise<Result<S>> {
  const method = opts.method ?? 'GET';
  let res = await sendAwake(path, method, opts.body, opts.signal, opts.raw).catch(
    (err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new ApiError(0, 'NETWORK', 'Network error — check your connection');
    },
  );

  if (res.status === 401 && !path.startsWith('/auth/')) {
    const { code } = await toError(res.clone());
    if ((code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED') && (await refreshSession())) {
      res = await sendAwake(path, method, opts.body, opts.signal, opts.raw);
    }
  }

  if (isWakingResponse(res)) {
    throw new ApiError(
      res.status,
      'NETWORK',
      'The server is still starting — try again in a moment',
    );
  }
  if (!res.ok) throw await toError(res);
  if (!opts.schema || res.status === 204) return undefined as Result<S>;
  return opts.schema.parse(await res.json()) as Result<S>;
}
