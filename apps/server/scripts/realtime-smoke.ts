/**
 * Realtime smoke test against a running dev server (`pnpm dev`):
 *   pnpm --filter server exec tsx scripts/realtime-smoke.ts [apiUrl] [appOrigin] [ops]
 * Registers two throwaway users, creates a room, joins both over Socket.IO, draws `ops`
 * elements from A and prints the latency A → server → B (and A's ack round trip).
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

const API = process.argv[2] ?? 'http://localhost:4000';
const ORIGIN = process.argv[3] ?? 'http://localhost:3000';
const OPS = Number(process.argv[4] ?? 100);
const headers = {
  origin: ORIGIN,
  'x-requested-with': 'rotationlab',
  'content-type': 'application/json',
};

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T documents the expected response shape
async function rest<T>(
  path: string,
  cookie: string,
  body?: unknown,
  method = 'POST',
): Promise<{ data: T; cookie: string }> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const set = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { data: (res.status === 204 ? undefined : await res.json()) as T, cookie: set || cookie };
}

async function user(tag: string) {
  const name = `smoke_${tag}_${Date.now().toString(36)}`.slice(0, 20);
  const r = await rest<{ user: { id: string } }>('/auth/register', '', {
    email: `${name}@example.com`,
    username: name,
    password: `smoke ${randomUUID()}`,
  });
  return { id: r.data.user.id, cookie: r.cookie };
}

function connect(cookie: string): Promise<Socket> {
  const socket = io(API, {
    path: '/realtime',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie, origin: ORIGIN },
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', reject);
  });
}

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? NaN;
const fmt = (xs: number[]) =>
  `p50 ${pct(xs, 50).toFixed(1)} ms · p95 ${pct(xs, 95).toFixed(1)} ms · max ${Math.max(...xs).toFixed(1)} ms`;

const a = await user('a');
const b = await user('b');
const { data: created } = await rest<{ room: { id: string }; board: { id: string } }>(
  '/rooms',
  a.cookie,
  {
    name: 'Realtime smoke',
    firstBoard: { name: 'Smoke board', mapId: 'erangel' },
  },
);
const { data: inv } = await rest<{ invite: { code: string } }>(
  `/rooms/${created.room.id}/invites`,
  a.cookie,
  { expiresIn: '1h' },
);
await rest(`/invites/${inv.invite.code}/accept`, b.cookie, {});

const [sa, sb] = await Promise.all([connect(a.cookie), connect(b.cookie)]);
const join = async (s: Socket) => {
  await s.emitWithAck('room:join', { roomId: created.room.id });
  return (await s.emitWithAck('board:subscribe', { boardId: created.board.id })) as {
    data: { layers: { id: string }[] };
  };
};
const state = await join(sa);
await join(sb);
const layerId = state.data.layers[0]?.id ?? '';

const sentAt = new Map<string, number>();
const oneWay: number[] = [];
const roundTrip: number[] = [];
const allReceived = new Promise<void>((resolve) => {
  sb.on('board:op', (op: { op: { element?: { id: string } } }) => {
    const id = op.op.element?.id;
    const t0 = id ? sentAt.get(id) : undefined;
    if (t0 !== undefined) oneWay.push(performance.now() - t0);
    if (oneWay.length === OPS) resolve();
  });
});

for (let i = 0; i < OPS; i++) {
  const id = randomUUID();
  const element = {
    id,
    boardId: created.board.id,
    layerId,
    type: 'ARROW',
    z: 0,
    props: {},
    geometry: {
      points: [
        [100_000 + i * 1000, 100_000],
        [300_000, 400_000 + i * 1000],
      ],
    },
    style: { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 },
  };
  const t0 = performance.now();
  sentAt.set(id, t0);
  const res = (await sa.emitWithAck('element:upsert', {
    opId: randomUUID(),
    boardId: created.board.id,
    element,
  })) as { ok: boolean; code?: string };
  roundTrip.push(performance.now() - t0);
  if (!res.ok) throw new Error(`upsert failed: ${res.code ?? '?'}`);
  await new Promise((r) => setTimeout(r, 20)); // ~50 ops/s, like a fast drawer
}
await Promise.race([
  allReceived,
  new Promise((_, rej) =>
    setTimeout(() => {
      rej(new Error('timed out waiting for broadcasts'));
    }, 10_000),
  ),
]);

console.log(`${OPS} element:upsert ops via ${API}`);
console.log(`  ack round trip (A → server → A): ${fmt(roundTrip)}`);
console.log(`  broadcast      (A → server → B): ${fmt(oneWay)}`);
console.log(`  PRD RT-1 target: p50 < 150 ms, p95 < 400 ms (same region)`);
sa.disconnect();
sb.disconnect();
