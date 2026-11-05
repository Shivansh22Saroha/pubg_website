'use client';

import { REALTIME_PATH, SocketTicketResponseSchema } from '@rotationlab/shared';
import { io } from 'socket.io-client';
import { create } from 'zustand';
import { env } from '@/env';
import { api, refreshSession } from '@/lib/api';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  createConnection,
  type Connection,
  type ConnectionStatus,
  type RtSocket,
} from './connection';

interface ConnectionState {
  status: ConnectionStatus;
  /** refresh failed: show the session-expired modal; unsent ops stay in memory */
  sessionExpired: boolean;
  online: boolean;
}

export const useConnection = create<ConnectionState>(() => ({
  status: 'idle',
  sessionExpired: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
}));

/**
 * Websocket upgrades do not pass through Next's dev rewrite (measured: 5/5 timeouts), nor
 * through Vercel's rewrites, so in dev, the E2E build and the Vercel deployment the socket goes
 * straight to the API (`NEXT_PUBLIC_SOCKET_URL`) and authenticates with a ticket (below). With
 * the Docker/Caddy deployment `/realtime` is served on the app origin.
 */
function socketUrl(): string {
  return env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin;
}

/**
 * Socket on another origin (dev, E2E, and Vercel + Railway where it is another *site*): the
 * access cookie may not reach it, so every (re)connect carries a fresh single-use ticket fetched
 * over the same-origin REST path (SECURITY A11). Same origin (Caddy): the cookie is enough.
 * socket.io calls this before each attempt; a failed fetch sends no ticket and the handshake's
 * UNAUTHENTICATED drives the usual refresh-and-retry in `createConnection`.
 */
function ticketAuth(url: string) {
  if (new URL(url).origin === window.location.origin) return undefined;
  return (cb: (data: object) => void) => {
    api('/auth/socket-ticket', { method: 'POST', schema: SocketTicketResponseSchema })
      .then(({ ticket }) => {
        cb({ ticket });
      })
      .catch(() => {
        cb({});
      });
  };
}

let socket: RtSocket | null = null;
let connection: Connection | null = null;

/** The typed singleton socket (one connection per tab). */
export function getSocket(): RtSocket {
  if (!socket) {
    const url = socketUrl();
    const auth = ticketAuth(url);
    socket = io(url, {
      ...(auth ? { auth } : {}),
      path: REALTIME_PATH,
      transports: ['websocket'],
      withCredentials: true,
      autoConnect: false,
      reconnectionDelay: BACKOFF_MIN_MS,
      reconnectionDelayMax: BACKOFF_MAX_MS,
      randomizationFactor: 0.5,
    });
    connection = createConnection({
      socket,
      refresh: refreshSession,
      onStatus: (status) => {
        useConnection.setState({ status });
      },
      onSessionExpired: () => {
        useConnection.setState({ sessionExpired: true, status: 'reconnecting' });
      },
    });
    window.addEventListener('online', () => {
      useConnection.setState({ online: true });
    });
    window.addEventListener('offline', () => {
      useConnection.setState({ online: false });
    });
  }
  return socket;
}

export function startRealtime() {
  getSocket();
  connection?.start();
}

export function stopRealtime() {
  connection?.stop();
}

export function resumeRealtime() {
  useConnection.setState({ sessionExpired: false });
  connection?.resume();
}
