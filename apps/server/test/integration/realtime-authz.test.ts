import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { ACKED_EVENTS, VOLATILE_EVENTS } from '../../src/realtime/server.js';
import {
  ack,
  arrow,
  collect,
  connect,
  joinBoard,
  listen,
  makeApp,
  opId,
  setupRoom,
  sleep,
  STYLE,
  useCleanState,
  type ClientSocket,
  type RoomFixture,
} from './harness.js';

/**
 * Socket authz matrix (SECURITY §3, TESTING §5.1): every client→server event × every caller.
 * Acked events expect `ok` or an error code; volatile events expect delivered / dropped at an
 * observer. Anonymous callers never get a socket at all. Fails if an event has no row.
 */
const CALLERS = ['anonymous', 'outsider', 'viewer', 'editor', 'owner'] as const;
type Caller = (typeof CALLERS)[number];

interface Ctx {
  f: RoomFixture;
  layerIds: string[];
  elementId: string;
  /** a member other than the caller (follow target) */
  other: string;
}

type Outcome = 'ok' | 'NOT_FOUND' | 'FORBIDDEN';
interface AckedRow {
  event: (typeof ACKED_EVENTS)[number];
  /** distinguishes several rows for one event */
  label?: string;
  payload: (ctx: Ctx) => unknown;
  expect: Record<Exclude<Caller, 'anonymous'>, Outcome>;
}
interface VolatileRow {
  event: (typeof VOLATILE_EVENTS)[number];
  payload: (ctx: Ctx) => unknown;
  delivered: Record<Exclude<Caller, 'anonymous'>, boolean>;
}

const member: Record<Exclude<Caller, 'anonymous'>, Outcome> = {
  outsider: 'NOT_FOUND',
  viewer: 'ok',
  editor: 'ok',
  owner: 'ok',
};
const write: Record<Exclude<Caller, 'anonymous'>, Outcome> = {
  outsider: 'NOT_FOUND',
  viewer: 'FORBIDDEN',
  editor: 'ok',
  owner: 'ok',
};
const joined: Record<Exclude<Caller, 'anonymous'>, Outcome> = {
  outsider: 'FORBIDDEN',
  viewer: 'ok',
  editor: 'ok',
  owner: 'ok',
};

const ACKED: AckedRow[] = [
  { event: 'room:join', payload: ({ f }) => ({ roomId: f.roomId }), expect: member },
  { event: 'room:leave', payload: ({ f }) => ({ roomId: f.roomId }), expect: joined },
  { event: 'board:subscribe', payload: ({ f }) => ({ boardId: f.boardId }), expect: member },
  {
    event: 'element:upsert',
    payload: ({ f, layerIds }) => ({
      opId: opId(),
      boardId: f.boardId,
      element: arrow(f.boardId, layerIds[0]!),
    }),
    expect: write,
  },
  {
    event: 'element:delete',
    payload: ({ f, elementId }) => ({ opId: opId(), boardId: f.boardId, elementId }),
    expect: write,
  },
  {
    event: 'element:batch',
    payload: ({ f, layerIds }) => ({
      boardId: f.boardId,
      ops: [{ opId: opId(), kind: 'upsert', element: arrow(f.boardId, layerIds[0]!) }],
    }),
    expect: write,
  },
  {
    event: 'layer:upsert',
    payload: ({ f }) => ({
      opId: opId(),
      boardId: f.boardId,
      layer: { id: opId(), name: 'New', color: '#22C55E', visible: true, locked: false },
    }),
    expect: write,
  },
  {
    // lock / unlock is OWNER-only (SECURITY §3)
    event: 'layer:upsert',
    label: 'lock',
    payload: ({ f, layerIds }) => ({
      opId: opId(),
      boardId: f.boardId,
      layer: { id: layerIds[0], name: 'Plan', color: '#F2A900', visible: true, locked: true },
    }),
    expect: { outsider: 'NOT_FOUND', viewer: 'FORBIDDEN', editor: 'FORBIDDEN', owner: 'ok' },
  },
  {
    event: 'layer:delete',
    payload: ({ f, layerIds }) => ({ opId: opId(), boardId: f.boardId, layerId: layerIds[2] }),
    expect: write,
  },
  {
    event: 'layer:reorder',
    payload: ({ f, layerIds }) => ({
      opId: opId(),
      boardId: f.boardId,
      order: [...layerIds].reverse(),
    }),
    expect: write,
  },
  {
    event: 'layer:clear',
    payload: ({ f, layerIds }) => ({ opId: opId(), boardId: f.boardId, layerId: layerIds[0] }),
    expect: write,
  },
  {
    event: 'presence:heartbeat',
    payload: ({ f }) => ({ roomId: f.roomId, boardId: f.boardId, idle: false }),
    expect: joined,
  },
  { event: 'follow:start', payload: ({ other }) => ({ targetUserId: other }), expect: member },
  {
    event: 'follow:stop',
    payload: ({ other }) => ({ targetUserId: other }),
    expect: { outsider: 'ok', viewer: 'ok', editor: 'ok', owner: 'ok' },
  },
  { event: 'summon', payload: ({ f }) => ({ boardId: f.boardId }), expect: write },
];

const everyMember = { outsider: false, viewer: true, editor: true, owner: true };
const VOLATILE: VolatileRow[] = [
  {
    event: 'cursor:move',
    payload: ({ f }) => ({ boardId: f.boardId, x: 1, y: 2 }),
    delivered: everyMember,
  },
  {
    event: 'laser:point',
    payload: ({ f }) => ({ boardId: f.boardId, x: 1, y: 2 }),
    delivered: everyMember,
  },
  {
    event: 'stroke:preview',
    payload: ({ f }) => ({ boardId: f.boardId, tempId: opId(), points: [[1, 2]], style: STYLE }),
    delivered: { outsider: false, viewer: false, editor: true, owner: true },
  },
  {
    event: 'view:update',
    payload: ({ f }) => ({ boardId: f.boardId, center: [1, 2], zoom: 1 }),
    delivered: everyMember,
  },
];

useCleanState();

let app: App;
let url: string;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
  url = await listen(app);
});

/** Fresh room; owner (always connected) creates one element; the caller connects + joins. */
async function prepare(caller: Exclude<Caller, 'anonymous'>) {
  const f = await setupRoom(app);
  const owner = await connect(url, f.owner.jar);
  const state = await joinBoard(owner, f.roomId, f.boardId);
  const layerIds = state.layers.map((l) => l.id);
  const el = arrow(f.boardId, layerIds[1]!);
  await ack(owner, 'element:upsert', { opId: opId(), boardId: f.boardId, element: el });
  const socket: ClientSocket = caller === 'owner' ? owner : await connect(url, f[caller].jar);
  if (caller !== 'owner' && caller !== 'outsider') await joinBoard(socket, f.roomId, f.boardId);
  const other = caller === 'owner' ? f.editor.id : f.owner.id;
  return { ctx: { f, layerIds, elementId: el.id, other } satisfies Ctx, socket, owner };
}

describe('socket authz matrix', () => {
  it('has exactly one row per handled event (add a row when you add an event)', () => {
    expect([...new Set(ACKED.map((r) => r.event))].sort()).toEqual([...ACKED_EVENTS].sort());
    expect(VOLATILE.map((r) => r.event).sort()).toEqual([...VOLATILE_EVENTS].sort());
  });

  it('anonymous callers cannot open a socket at all', async () => {
    const err = await connect(url, null).catch((e: { data?: { code?: string } }) => e);
    expect(err).toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
  });

  for (const row of ACKED) {
    for (const caller of CALLERS) {
      if (caller === 'anonymous') continue; // covered above: no socket
      const want = row.expect[caller];
      it(`${row.event}${row.label ? ` (${row.label})` : ''} as ${caller} → ${want}`, async () => {
        const { ctx, socket } = await prepare(caller);
        const res = await ack(socket, row.event, row.payload(ctx));
        if (want === 'ok') expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
        else expect(res).toMatchObject({ ok: false, code: want });
      });
    }
  }

  for (const row of VOLATILE) {
    for (const caller of CALLERS) {
      if (caller === 'anonymous') continue;
      const want = row.delivered[caller];
      it(`${row.event} as ${caller} → ${want ? 'delivered' : 'dropped'}`, async () => {
        const { ctx, socket, owner } = await prepare(caller);
        // observer: another subscribed member (following the caller, for view:update)
        let observer: ClientSocket = owner;
        if (caller === 'owner') {
          observer = await connect(url, ctx.f.editor.jar);
          await joinBoard(observer, ctx.f.roomId, ctx.f.boardId);
        }
        if (row.event === 'view:update') {
          const callerId = caller === 'outsider' ? ctx.f.outsider.id : ctx.f[caller].id;
          await ack(observer, 'follow:start', { targetUserId: callerId });
        }
        const seen = collect(observer, row.event);
        // volatile packets may be dropped while the receiver is busy — probe a few times
        for (let i = 0; i < 3; i++) {
          socket.emit(row.event, row.payload(ctx) as never);
          await sleep(100);
        }
        await sleep(150);
        expect(seen.length > 0).toBe(want);
      });
    }
  }
});
