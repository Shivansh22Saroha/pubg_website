/* global __ENV, __VU, open */
/**
 * k6 realtime load test (TESTING §7): every VU is one room member speaking Socket.IO over a raw
 * websocket (k6 has no Socket.IO client). It joins its room, subscribes to the board, moves its
 * own marker 2×/s (`element:upsert`, label = send time) and its cursor at 20 Hz. Others measure
 * broadcast latency from the label when the `board:op` arrives.
 *
 * Targets: p95 op broadcast < 400 ms, op error rate < 0.1 % (server CPU < 70 % is read from
 * `docker stats` while it runs). Fixtures: apps/server/scripts/loadtest-seed.ts → users.json.
 *
 *   docker run --rm -i --network host -v "$PWD/loadtest:/lt" grafana/k6:1.3.0 run \
 *     -e BASE=wss://staging.example.com -e DURATION=10m /lt/realtime.js
 */
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';

const fixtures = JSON.parse(open(__ENV.USERS || './users.json'));
const BASE = __ENV.BASE || 'wss://localhost';
const DURATION_S = parseDuration(__ENV.DURATION || '10m');
const RAMP_S = Number(__ENV.RAMP_S || 30);
const VUS = Number(__ENV.VUS || fixtures.users.length);
const OP_EVERY_MS = 500; // 2 ops/s
const CURSOR_HZ = Number(__ENV.CURSOR_HZ ?? 20); // 0 = no cursor traffic (isolate the op path)

export const options = {
  insecureSkipTLSVerify: __ENV.INSECURE === '1',
  scenarios: {
    members: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: `${DURATION_S + RAMP_S + 60}s`,
    },
  },
  thresholds: {
    broadcast_latency: ['p(95)<400'],
    op_errors: ['rate<0.001'],
    connect_errors: ['count==0'],
    // a run that measured nothing must fail, not pass vacuously
    ops_received: ['count>0'],
    checks: ['rate==1'],
  },
};

const broadcastLatency = new Trend('broadcast_latency', true);
const ackLatency = new Trend('ack_latency', true);
const opErrors = new Rate('op_errors');
const connectErrors = new Counter('connect_errors');
const opsReceived = new Counter('ops_received');
const errorCodes = {}; // per VU, printed once at the end (DEBUG=1)

function parseDuration(s) {
  const m = /^(\d+)(s|m)$/.exec(s);
  if (!m) throw new Error(`DURATION like 90s or 10m, got ${s}`);
  return Number(m[1]) * (m[2] === 'm' ? 60 : 1);
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function () {
  const me = fixtures.users[(__VU - 1) % fixtures.users.length];
  const markerId = uuid();
  const url = `${BASE}/realtime/?EIO=4&transport=websocket`;
  const params = {
    headers: { Cookie: `${fixtures.cookieName}=${me.token}`, Origin: fixtures.origin },
  };
  // spread the connects over the ramp so the run starts like a real evening, not a stampede
  const startDelayMs = ((__VU - 1) / VUS) * RAMP_S * 1000;
  let ackId = 0;
  const pending = new Map(); // ack id → { kind, sentAt }
  sleep(startDelayMs / 1000);

  const res = ws.connect(url, params, (socket) => {
    const emit = (event, payload, kind) => {
      if (!kind) return socket.send(`42${JSON.stringify([event, payload])}`);
      ackId += 1;
      pending.set(ackId, { kind, sentAt: Date.now() });
      return socket.send(`42${ackId}${JSON.stringify([event, payload])}`);
    };

    const startLoad = () => {
      socket.setInterval(() => {
        const now = Date.now();
        emit(
          'element:upsert',
          {
            opId: uuid(),
            boardId: me.boardId,
            element: {
              id: markerId,
              boardId: me.boardId,
              layerId: me.layerId,
              type: 'MARKER',
              style: { color: '#38BDF8', width: 2, dashed: false, fillOpacity: 0 },
              z: 0,
              geometry: { at: [100000 + (now % 600000), 100000 + (__VU % 600) * 1000] },
              props: { kind: 'pin', label: String(now) },
            },
          },
          'op',
        );
      }, OP_EVERY_MS);
      if (CURSOR_HZ > 0)
        socket.setInterval(() => {
          emit('cursor:move', {
            boardId: me.boardId,
            x: Math.floor(Math.random() * 816000),
            y: Math.floor(Math.random() * 816000),
          });
        }, 1000 / CURSOR_HZ);
      socket.setTimeout(() => socket.close(), DURATION_S * 1000);
    };

    socket.on('message', (msg) => {
      if (msg === '2') return socket.send('3'); // engine.io ping → pong
      if (msg.startsWith('0')) return socket.send('40'); // engine open → socket.io connect
      if (msg.startsWith('40')) return emit('room:join', { roomId: me.roomId }, 'join');
      if (msg.startsWith('44')) {
        connectErrors.add(1);
        return socket.close();
      }
      const ack = /^43(\d+)(.*)$/.exec(msg);
      if (ack) {
        const p = pending.get(Number(ack[1]));
        pending.delete(Number(ack[1]));
        if (!p) return undefined;
        const body = JSON.parse(ack[2])[0];
        if (p.kind === 'op') {
          opErrors.add(!body.ok);
          if (!body.ok) errorCodes[body.code] = (errorCodes[body.code] || 0) + 1;
          ackLatency.add(Date.now() - p.sentAt);
        } else if (!body.ok) {
          connectErrors.add(1);
          socket.close();
        } else if (p.kind === 'join') {
          emit('board:subscribe', { boardId: me.boardId }, 'subscribe');
        } else if (p.kind === 'subscribe') {
          startLoad();
        }
        return undefined;
      }
      if (msg.startsWith('42["board:op"')) {
        const [, op] = JSON.parse(msg.slice(2));
        if (op.actorId !== me.userId && op.op.kind === 'element:upsert') {
          const sent = Number(op.op.element.props.label);
          if (sent) broadcastLatency.add(Date.now() - sent);
          opsReceived.add(1);
        }
      }
      return undefined;
    });

    socket.on('error', () => connectErrors.add(1));
    socket.on('close', () => {
      if (__ENV.DEBUG === '1' && Object.keys(errorCodes).length > 0)
        console.log(`codes ${JSON.stringify(errorCodes)}`);
    });
  });

  check(res, { 'websocket upgraded (101)': (r) => r && r.status === 101 });
}
