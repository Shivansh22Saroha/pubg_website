import type { ClientToServerEvents, ServerToClientEvents } from '@rotationlab/shared';
import type { Socket } from 'socket.io-client';

export type RtSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 10_000;
/** refresh this long before the access token expires */
export const PROACTIVE_REFRESH_MS = 60_000;

/** Exponential backoff 0.5 s → 10 s with ±50 % jitter, clamped to the range. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.round(Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, base * (0.5 + random()))));
}

/** The subset of a socket.io-client Socket this module uses (lets tests pass a fake). */
export interface SocketLike {
  connected: boolean;
  active: boolean;
  connect(): unknown;
  disconnect(): unknown;
  on(event: string, fn: (...args: never[]) => void): unknown;
}

export interface ConnectionDeps {
  socket: SocketLike;
  /** shared `/auth/refresh` (lib/api.ts) — one network call for concurrent callers */
  refresh: () => Promise<boolean>;
  onStatus: (status: ConnectionStatus) => void;
  onSessionExpired: () => void;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  random?: () => number;
}

const AUTH_CODES = new Set(['TOKEN_EXPIRED', 'UNAUTHENTICATED']);

/**
 * Owns one socket's lifecycle (ARCHITECTURE §7.4, API_SPEC §7.1):
 * - transport drops → socket.io's own jittered backoff (0.5–10 s);
 * - server-side disconnects and handshake rejections → our backoff, refreshing the session first
 *   when the reason was an expired/invalid token; a failed refresh → `onSessionExpired` (pending
 *   ops stay in memory);
 * - `session { expiresAt }` → refresh ~60 s early, then a *silent* reconnect (status stays
 *   "connected", the room session resyncs by delta — nothing on screen changes).
 */
export function createConnection(deps: ConnectionDeps) {
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      return () => {
        clearTimeout(t);
      };
    });
  const now = deps.now ?? Date.now;
  const { socket } = deps;
  let attempt = 0;
  let cancelRetry: (() => void) | null = null;
  let cancelProactive: (() => void) | null = null;
  let needsRefresh = false;
  let silent = false;
  let stopped = true;

  const status = (s: ConnectionStatus) => {
    if (silent && s !== 'connected') return;
    deps.onStatus(s);
  };

  async function reconnectWithRefresh() {
    const ok = await deps.refresh();
    if (stopped) return;
    if (!ok) {
      silent = false;
      deps.onSessionExpired();
      return;
    }
    needsRefresh = false;
    socket.connect();
  }

  function retryLater() {
    if (stopped) return;
    cancelRetry?.();
    status('reconnecting');
    cancelRetry = schedule(
      () => {
        cancelRetry = null;
        if (needsRefresh) void reconnectWithRefresh();
        else socket.connect();
      },
      backoffDelay(attempt++, deps.random),
    );
  }

  socket.on('connect', () => {
    attempt = 0;
    silent = false;
    status('connected');
  });

  socket.on('disconnect', (reason: string) => {
    if (stopped) return;
    if (reason === 'io server disconnect') {
      // kick, logout elsewhere, or token expiry (an `error` event set needsRefresh just before)
      retryLater();
    } else if (reason !== 'io client disconnect') {
      status('reconnecting'); // transport drop: socket.io reconnects by itself
    }
  });

  socket.on('error', (p: { code?: string } | undefined) => {
    if (p?.code === 'TOKEN_EXPIRED') needsRefresh = true;
  });

  socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
    if (stopped) return;
    const code = err.data?.code;
    if (code && AUTH_CODES.has(code)) {
      needsRefresh = true;
      retryLater();
    } else if (!socket.active) {
      retryLater(); // handshake rejected (e.g. LIMIT_REACHED) — socket.io won't retry on its own
    } else {
      status('reconnecting');
    }
  });

  socket.on('session', ({ expiresAt }: { expiresAt: number }) => {
    cancelProactive?.();
    const wait = Math.max(0, expiresAt - PROACTIVE_REFRESH_MS - now());
    cancelProactive = schedule(() => {
      cancelProactive = null;
      void (async () => {
        if (stopped || !(await deps.refresh())) return; // the server-side expiry path takes over
        silent = true; // reconnect quietly with the fresh cookie
        socket.disconnect();
        socket.connect();
      })();
    }, wait);
  });

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (!socket.connected) {
        status('connecting');
        socket.connect();
      }
    },
    stop() {
      stopped = true;
      cancelRetry?.();
      cancelProactive?.();
      socket.disconnect();
      deps.onStatus('idle');
    },
    /** after the user logs in again from the session-expired modal */
    resume() {
      needsRefresh = false;
      socket.connect();
    },
  };
}
export type Connection = ReturnType<typeof createConnection>;
