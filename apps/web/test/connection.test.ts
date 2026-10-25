import { describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  backoffDelay,
  createConnection,
  PROACTIVE_REFRESH_MS,
  type SocketLike,
} from '@/lib/realtime/connection';

class FakeSocket implements SocketLike {
  connected = false;
  active = true;
  connects = 0;
  disconnects = 0;
  private handlers = new Map<string, ((...a: never[]) => void)[]>();
  on(event: string, fn: (...a: never[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
  }
  fire(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) fn(...(args as never[]));
  }
  connect() {
    this.connects++;
  }
  disconnect() {
    this.disconnects++;
    this.connected = false;
  }
}

/** manual scheduler: run due tasks explicitly */
function scheduler() {
  const tasks: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    tasks,
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false };
      tasks.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    runAll: () => {
      for (const t of tasks.splice(0)) if (!t.cancelled) t.fn();
    },
  };
}

function setup(refreshResult = true) {
  const socket = new FakeSocket();
  const sched = scheduler();
  const statuses: string[] = [];
  const refresh = vi.fn(() => Promise.resolve(refreshResult));
  const onSessionExpired = vi.fn();
  const conn = createConnection({
    socket,
    refresh,
    onStatus: (s) => statuses.push(s),
    onSessionExpired,
    schedule: sched.schedule,
    now: () => 1_000_000,
    random: () => 0.5,
  });
  conn.start();
  return { socket, sched, statuses, refresh, onSessionExpired, conn };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('backoff', () => {
  it('grows exponentially from 0.5 s, jittered ±50 %, capped at 10 s', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(500);
    expect(backoffDelay(1, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, () => 0.5)).toBe(4000);
    expect(backoffDelay(10, () => 0.5)).toBe(BACKOFF_MAX_MS);
    for (let a = 0; a < 12; a++) {
      for (const r of [0, 0.25, 0.99]) {
        const d = backoffDelay(a, () => r);
        expect(d).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
        expect(d).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      }
    }
    expect(backoffDelay(2, () => 0)).toBe(1000); // 2000 × 0.5
    expect(backoffDelay(2, () => 0.99)).toBe(2980); // 2000 × 1.49
  });
});

describe('connection lifecycle', () => {
  it('connects on start and reports status', () => {
    const { socket, statuses } = setup();
    expect(socket.connects).toBe(1);
    socket.connected = true;
    socket.fire('connect');
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('connect_error TOKEN_EXPIRED → refresh (shared) → reconnect', async () => {
    const { socket, sched, refresh } = setup(true);
    socket.fire(
      'connect_error',
      Object.assign(new Error('x'), { data: { code: 'TOKEN_EXPIRED' } }),
    );
    expect(refresh).not.toHaveBeenCalled(); // waits for the backoff first
    sched.runAll();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connects).toBe(2);
  });

  it('server-side TOKEN_EXPIRED disconnect → refresh → reconnect', async () => {
    const { socket, sched, refresh } = setup(true);
    socket.fire('error', { code: 'TOKEN_EXPIRED' });
    socket.fire('disconnect', 'io server disconnect');
    sched.runAll();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connects).toBe(2);
  });

  it('a failed refresh shows the session-expired modal and does not reconnect', async () => {
    const { socket, sched, onSessionExpired } = setup(false);
    socket.fire(
      'connect_error',
      Object.assign(new Error('x'), { data: { code: 'UNAUTHENTICATED' } }),
    );
    sched.runAll();
    await flush();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(socket.connects).toBe(1);
  });

  it('kick / logout elsewhere ("io server disconnect" without an auth error) → plain reconnect after backoff', async () => {
    const { socket, sched, refresh, statuses } = setup();
    socket.fire('disconnect', 'io server disconnect');
    expect(statuses.at(-1)).toBe('reconnecting');
    sched.runAll();
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(socket.connects).toBe(2);
  });

  it('transport drops are left to socket.io’s own reconnection', () => {
    const { socket, sched, statuses } = setup();
    socket.fire('disconnect', 'transport close');
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(sched.tasks).toHaveLength(0);
  });

  it('proactively refreshes 60 s before expiry and reconnects silently (no status flicker)', async () => {
    const { socket, sched, refresh, statuses } = setup(true);
    socket.connected = true;
    socket.fire('connect');
    const expiresAt = 1_000_000 + 15 * 60_000;
    socket.fire('session', { expiresAt });
    expect(sched.tasks[0]?.ms).toBe(expiresAt - PROACTIVE_REFRESH_MS - 1_000_000);
    const before = statuses.length;
    sched.runAll();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.disconnects).toBe(1);
    expect(socket.connects).toBe(2);
    socket.fire('disconnect', 'io client disconnect');
    socket.fire('connect');
    // only "connected" again — never "reconnecting"
    expect(statuses.slice(before)).toEqual(['connected']);
  });

  it('stop() cancels pending retries and reports idle', () => {
    const { socket, sched, conn, statuses } = setup();
    socket.fire('disconnect', 'io server disconnect');
    conn.stop();
    sched.runAll();
    expect(socket.connects).toBe(1);
    expect(statuses.at(-1)).toBe('idle');
  });
});
