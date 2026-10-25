'use client';

import { REALTIME_PATH } from '@rotationlab/shared';
import { io } from 'socket.io-client';
import { create } from 'zustand';
import { env } from '@/env';
import { refreshSession } from '@/lib/api';
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
 * Websocket upgrades do not pass through Next's dev rewrite (measured: 5/5 timeouts), so in
 * dev and in the E2E build the socket goes straight to the API (`NEXT_PUBLIC_SOCKET_URL`). The
 * auth cookie is host-only on `localhost`, and cookies ignore ports, so it is still sent. In
 * production Caddy serves `/realtime` on the app origin.
 */
function socketUrl(): string {
  return env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin;
}

let socket: RtSocket | null = null;
let connection: Connection | null = null;

/** The typed singleton socket (one connection per tab). */
export function getSocket(): RtSocket {
  if (!socket) {
    socket = io(socketUrl(), {
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
