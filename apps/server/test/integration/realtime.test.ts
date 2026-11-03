import { CURSOR_FLUSH_MS } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { withLeaderLock } from '../../src/jobs/index.js';
import { createTokenService } from '../../src/modules/auth/tokens.js';
import { pruneBoardOps } from '../../src/modules/elements/service.js';
import {
  ack,
  arrow,
  call,
  collect,
  connect,
  createRoom,
  joinBoard,
  login,
  makeApp,
  nextEvent,
  opId,
  prisma,
  redis,
  register,
  setupRoom,
  sleep,
  STYLE,
  useCleanState,
  type ClientSocket,
  type RoomFixture,
} from './harness.js';
import { cookieHeader, listen } from './harness.js';
import { APP_ORIGIN } from '../helpers.js';
import { io as ioClient } from 'socket.io-client';

useCleanState();

let app: App;
let url: string;
let config: Awaited<ReturnType<typeof makeApp>>['config'];
beforeAll(async () => {
  ({ app, config } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
  url = await listen(app);
});

interface Live {
  f: RoomFixture;
  owner: ClientSocket;
  editor: ClientSocket;
  viewer: ClientSocket;
  layerIds: string[];
}

/** Fixture room with owner/editor/viewer connected, joined and subscribed to the first board. */
async function live(): Promise<Live> {
  const f = await setupRoom(app);
  const [owner, editor, viewer] = await Promise.all(
    [f.owner, f.editor, f.viewer].map((u) => connect(url, u.jar)),
  );
  const state = await joinBoard(owner!, f.roomId, f.boardId);
  await joinBoard(editor!, f.roomId, f.boardId);
  await joinBoard(viewer!, f.roomId, f.boardId);
  return {
    f,
    owner: owner!,
    editor: editor!,
    viewer: viewer!,
    layerIds: state.layers.map((l) => l.id),
  };
}

const boardRow = (id: string) => prisma.board.findUniqueOrThrow({ where: { id } });

describe('handshake (API_SPEC §7.1, SECURITY T2)', () => {
  it('rejects a connection without a cookie: UNAUTHENTICATED', async () => {
    const err = await connect(url, null).catch((e: { data?: { code?: string } }) => e);
    expect(err).toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects a bad Origin', async () => {
    const { jar } = await register(app);
    const err = await connect(url, jar, { origin: 'https://evil.example' }).catch(
      (e: { data?: { code?: string } }) => e,
    );
    expect(err).toMatchObject({ data: { code: 'FORBIDDEN' } });
  });

  it('reports an expired access token as TOKEN_EXPIRED', async () => {
    const { res } = await register(app);
    const past = createTokenService(
      {
        secret: config.JWT_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        ttlSec: 900,
      },
      () => Date.now() - 3600_000,
    );
    const token = await past.sign({
      sub: res.json<{ user: { id: string } }>().user.id,
      sid: opId(),
    });
    const err = await connect(url, null, { cookie: `rl_at=${token}` }).catch(
      (e: { data?: { code?: string } }) => e,
    );
    expect(err).toMatchObject({ data: { code: 'TOKEN_EXPIRED' } });
  });

  it('allows at most 5 sockets per user', async () => {
    const { jar } = await register(app);
    for (let i = 0; i < 5; i++) await connect(url, jar);
    const err = await connect(url, jar).catch((e: { data?: { code?: string } }) => e);
    expect(err).toMatchObject({ data: { code: 'LIMIT_REACHED' } });
  });

  it('reads the __Host- cookie in the production cookie config', async () => {
    const { app: prod } = await makeApp({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      RATE_LIMITS_ENABLED: 'true',
    });
    const prodUrl = await listen(prod);
    const { jar } = await register(prod);
    expect(Object.keys(jar.cookies)).toContain('__Host-rl_at');
    const socket = await connect(prodUrl, jar);
    expect(socket.connected).toBe(true);
  });
});

describe('rooms & boards', () => {
  it('room:join: members get members/presence/boards; outsiders get NOT_FOUND', async () => {
    const f = await setupRoom(app);
    const owner = await connect(url, f.owner.jar);
    const res = await ack(owner, 'room:join', { roomId: f.roomId });
    expect(res.ok).toBe(true);
    expect(res.data.members).toHaveLength(3);
    expect(
      res.data.members.find((m: { user: { id: string } }) => m.user.id === f.owner.id).online,
    ).toBe(true);
    expect(res.data.presence).toEqual([
      expect.objectContaining({ userId: f.owner.id, idle: false }),
    ]);
    expect(res.data.boards).toHaveLength(1);

    const outsider = await connect(url, f.outsider.jar);
    expect(await ack(outsider, 'room:join', { roomId: f.roomId })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('board:subscribe requires room:join, returns the full state, and rejects other rooms', async () => {
    const f = await setupRoom(app);
    const owner = await connect(url, f.owner.jar);
    expect(await ack(owner, 'board:subscribe', { boardId: f.boardId })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    const state = await joinBoard(owner, f.roomId, f.boardId);
    expect(state).toMatchObject({ mode: 'full', seq: 0, elements: [] });
    expect(state.layers.map((l) => l.name)).toEqual(['Plan', 'Enemies', 'Zones']);
    const other = await createRoom(app, f.outsider.jar, { name: 'Other room' });
    expect(await ack(owner, 'board:subscribe', { boardId: other.board.id })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});

describe('element ops (ARCHITECTURE §7.2)', () => {
  it('upsert: seq allocated, row + op log written, broadcast to others but not the sender', async () => {
    const l = await live();
    const toOwner = collect(l.owner, 'board:op');
    const toEditor = collect(l.editor, 'board:op');
    const el = arrow(l.f.boardId, l.layerIds[0]!);
    const res = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: el,
    });
    expect(res).toEqual({ ok: true, data: { seq: 1 } });
    await sleep(150);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]).toMatchObject({
      seq: 1,
      actorId: l.f.editor.id,
      op: { kind: 'element:upsert', element: { id: el.id, seq: 1 } },
    });
    expect(toEditor).toHaveLength(0);
    expect(await boardRow(l.f.boardId)).toMatchObject({ lastSeq: 1n, elementCount: 1 });
    expect(await prisma.boardOp.count({ where: { boardId: l.f.boardId } })).toBe(1);
    expect((await prisma.element.findUniqueOrThrow({ where: { id: el.id } })).seq).toBe(1n);
  });

  it('double-headed arrows (Phase 11): stored and broadcast; a bad flag is rejected', async () => {
    const l = await live();
    const toOwner = collect(l.owner, 'board:op');
    const el = { ...arrow(l.f.boardId, l.layerIds[0]!), props: { doubleHeaded: true } };
    const res = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: el,
    });
    expect(res).toMatchObject({ ok: true });
    await sleep(150);
    expect(toOwner[0]).toMatchObject({ op: { element: { props: { doubleHeaded: true } } } });
    expect((await prisma.element.findUniqueOrThrow({ where: { id: el.id } })).props).toEqual({
      doubleHeaded: true,
    });
    const bad = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: { ...el, props: { doubleHeaded: 'yes' } },
    });
    expect(bad).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('curved arrows (Phase 12): stored and broadcast with both flags', async () => {
    const l = await live();
    const toOwner = collect(l.owner, 'board:op');
    const el = {
      ...arrow(l.f.boardId, l.layerIds[0]!),
      props: { curved: true, doubleHeaded: true },
    };
    const res = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: el,
    });
    expect(res).toMatchObject({ ok: true });
    await sleep(150);
    expect(toOwner[0]).toMatchObject({
      op: { element: { props: { curved: true, doubleHeaded: true } } },
    });
  });

  it('loot markers (Phase 12): a registry item is stored; anything else is refused', async () => {
    const l = await live();
    const base = {
      boardId: l.f.boardId,
      layerId: l.layerIds[0]!,
      type: 'MARKER',
      geometry: { at: [100_000, 100_000] },
      style: STYLE,
      z: 0,
    };
    const send = (props: object) =>
      ack(l.editor, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: { ...base, id: opId(), props },
      });
    expect(await send({ kind: 'loot', item: 'm416' })).toMatchObject({ ok: true });
    expect(await send({ kind: 'loot', item: '../../package.json' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(await send({ kind: 'pin', item: 'm416' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
  });

  it('linked own-player markers (Phase 12): a member is accepted, anyone else refused', async () => {
    const l = await live();
    const base = {
      boardId: l.f.boardId,
      layerId: l.layerIds[0]!,
      type: 'MARKER',
      geometry: { at: [100_000, 100_000] },
      style: STYLE,
      z: 0,
    };
    const ok = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: {
        ...base,
        id: opId(),
        props: { kind: 'own_player', number: 1, memberId: l.f.viewer.id },
      },
    });
    expect(ok).toMatchObject({ ok: true });
    const outsider = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: {
        ...base,
        id: opId(),
        props: { kind: 'own_player', number: 2, memberId: l.f.outsider.id },
      },
    });
    expect(outsider).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    const wrongKind = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: { ...base, id: opId(), props: { kind: 'enemy_squad', memberId: l.f.viewer.id } },
    });
    expect(wrongKind).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('a viewer emitting via the raw socket is rejected: nothing broadcast, DB unchanged', async () => {
    const l = await live();
    const toOwner = collect(l.owner, 'board:op');
    const res = await ack(l.viewer, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, l.layerIds[0]!),
    });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    for (const ev of ['element:delete', 'layer:clear'] as const) {
      const r = await ack(l.viewer, ev, {
        opId: opId(),
        boardId: l.f.boardId,
        ...(ev === 'element:delete' ? { elementId: opId() } : { layerId: l.layerIds[0] }),
      });
      expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }
    await sleep(150);
    expect(toOwner).toEqual([]);
    expect(await boardRow(l.f.boardId)).toMatchObject({ lastSeq: 0n, elementCount: 0 });
    expect(await prisma.element.count()).toBe(0);
  });

  it('an op targeting a board of another room is rejected', async () => {
    const l = await live();
    const other = await createRoom(app, l.f.outsider.jar, { name: 'Other room' });
    const otherLayer = (await prisma.layer.findFirstOrThrow({ where: { boardId: other.board.id } }))
      .id;
    // board of a room the editor isn't in → 404
    const r1 = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: other.board.id,
      element: arrow(other.board.id, otherLayer),
    });
    expect(r1).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // element claims another board than the message → rejected
    const r2 = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(other.board.id, otherLayer),
    });
    expect(r2).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    // a layer from another board → not found on this board
    const r3 = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, otherLayer),
    });
    expect(r3).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await prisma.element.count()).toBe(0);
  });

  it('a member of two rooms must join the room before writing to its boards', async () => {
    const l = await live();
    const second = await createRoom(app, l.f.editor.jar, { name: 'Editor room' });
    const layer = (await prisma.layer.findFirstOrThrow({ where: { boardId: second.board.id } })).id;
    const r = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: second.board.id,
      element: arrow(second.board.id, layer),
    });
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('validates geometry limits and map bounds', async () => {
    const l = await live();
    const send = (over: Record<string, unknown>) =>
      ack(l.editor, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: arrow(l.f.boardId, l.layerIds[0]!, over),
      });
    const outside = await send({
      geometry: {
        points: [
          [0, 0],
          [816_001, 10],
        ],
      },
    });
    expect(outside).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    const tooMany = await send({
      type: 'STROKE',
      geometry: { points: Array.from({ length: 2001 }, (_, i) => [i, i]) },
    });
    expect(tooMany).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await send({ style: { ...arrow('', '').style, color: 'red' } })).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(await send({ owner: 'x' })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(
      await send({
        geometry: {
          points: [
            [-1, 0],
            [5, 5],
          ],
        },
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    const marker = await send({
      type: 'MARKER',
      geometry: { at: [512_300, 401_800] },
      props: { kind: 'enemy_squad', number: 7, label: 'Bridge team' },
    });
    expect(marker.ok).toBe(true);
    expect(await prisma.element.count()).toBe(1);
  });

  it('locked layers reject element ops server-side (SECURITY Z4)', async () => {
    const l = await live();
    const layerId = l.layerIds[1]!;
    const el = arrow(l.f.boardId, layerId);
    expect(
      (await ack(l.editor, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: el }))
        .ok,
    ).toBe(true);
    const lock = await ack(l.owner, 'layer:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      layer: { id: layerId, name: 'Enemies', color: '#EF4444', visible: true, locked: true },
    });
    expect(lock.ok).toBe(true);
    expect(
      await ack(l.owner, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: arrow(l.f.boardId, layerId),
      }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(
      await ack(l.owner, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: { ...el, style: { ...el.style, width: 7 } },
      }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(
      await ack(l.owner, 'element:delete', {
        opId: opId(),
        boardId: l.f.boardId,
        elementId: el.id,
      }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    // moving an element INTO a locked layer is rejected too
    const free = arrow(l.f.boardId, l.layerIds[0]!);
    await ack(l.owner, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: free });
    expect(
      await ack(l.owner, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: { ...free, layerId },
      }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('concurrent upserts to the same element get distinct seqs and converge on the higher one', async () => {
    const l = await live();
    const id = arrow(l.f.boardId, l.layerIds[0]!).id;
    const base = arrow(l.f.boardId, l.layerIds[0]!, { id });
    await ack(l.owner, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: base });

    // each client keeps a local copy and applies LWW exactly like boardStore will (Phase 5B)
    const local = { owner: { seq: 0, color: '' }, editor: { seq: 0, color: '' } };
    const apply = (who: 'owner' | 'editor', seq: number, color: string) => {
      if (seq > local[who].seq) local[who] = { seq, color };
    };
    l.owner.on('board:op', (o) => {
      apply(
        'owner',
        o.seq,
        (o.op as { element: { style: { color: string } } }).element.style.color,
      );
    });
    l.editor.on('board:op', (o) => {
      apply(
        'editor',
        o.seq,
        (o.op as { element: { style: { color: string } } }).element.style.color,
      );
    });

    const red = { ...base, style: { ...base.style, color: '#EF4444' } };
    const sky = { ...base, style: { ...base.style, color: '#38BDF8' } };
    const [a, b] = await Promise.all([
      ack(l.owner, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: red }),
      ack(l.editor, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: sky }),
    ]);
    apply('owner', a.data.seq, '#EF4444');
    apply('editor', b.data.seq, '#38BDF8');
    expect(a.data.seq).not.toBe(b.data.seq);
    await sleep(200);

    const row = await prisma.element.findUniqueOrThrow({ where: { id } });
    const winner = Math.max(a.data.seq, b.data.seq);
    expect(Number(row.seq)).toBe(winner);
    expect(local.owner).toEqual(local.editor);
    expect(local.owner).toEqual({ seq: winner, color: (row.style as { color: string }).color });
  });

  it('a resent opId is idempotent: same seq, no second write, no second broadcast', async () => {
    const l = await live();
    const toOwner = collect(l.owner, 'board:op');
    const msg = { opId: opId(), boardId: l.f.boardId, element: arrow(l.f.boardId, l.layerIds[0]!) };
    const first = await ack(l.editor, 'element:upsert', msg);
    const again = await ack(l.editor, 'element:upsert', msg);
    expect(again).toEqual(first);
    await sleep(150);
    expect(toOwner).toHaveLength(1);
    expect(await boardRow(l.f.boardId)).toMatchObject({ lastSeq: 1n, elementCount: 1 });
    expect(await prisma.boardOp.count()).toBe(1);
  });

  it('a resent batch mixing applied and new ops re-applies nothing and broadcasts only the new ones', async () => {
    const l = await live();
    const toOwner = collect(l.owner, 'board:op');
    const a = { opId: opId(), kind: 'upsert', element: arrow(l.f.boardId, l.layerIds[0]!) };
    const b = { opId: opId(), kind: 'upsert', element: arrow(l.f.boardId, l.layerIds[0]!) };
    const first = await ack(l.editor, 'element:batch', { boardId: l.f.boardId, ops: [a] });
    expect(first.data.seqs).toEqual([1]);
    const mixed = await ack(l.editor, 'element:batch', { boardId: l.f.boardId, ops: [a, b] });
    expect(mixed.data.seqs).toEqual([1, 2]);
    const replay = await ack(l.editor, 'element:batch', { boardId: l.f.boardId, ops: [b, a] });
    expect(replay.data.seqs).toEqual([2, 1]);
    await sleep(150);
    expect(toOwner.map((o) => o.seq)).toEqual([1, 2]);
    expect(await boardRow(l.f.boardId)).toMatchObject({ lastSeq: 2n, elementCount: 2 });
  });

  it('pipelined ops from one socket apply in emit order (upsert then delete, no await)', async () => {
    const l = await live();
    const el = arrow(l.f.boardId, l.layerIds[0]!);
    const [up, del] = await Promise.all([
      ack(l.editor, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: el }),
      ack(l.editor, 'element:delete', { opId: opId(), boardId: l.f.boardId, elementId: el.id }),
    ]);
    expect(up.data.seq).toBe(1);
    expect(del.data.seq).toBe(2);
    expect(await prisma.element.count()).toBe(0);
  });

  it('delete keeps element_count exact and still converges when the element is already gone', async () => {
    const l = await live();
    const el = arrow(l.f.boardId, l.layerIds[0]!);
    await ack(l.editor, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: el });
    expect(
      (
        await ack(l.owner, 'element:delete', {
          opId: opId(),
          boardId: l.f.boardId,
          elementId: el.id,
        })
      ).data.seq,
    ).toBe(2);
    expect(
      (
        await ack(l.editor, 'element:delete', {
          opId: opId(),
          boardId: l.f.boardId,
          elementId: el.id,
        })
      ).data.seq,
    ).toBe(3);
    expect(await boardRow(l.f.boardId)).toMatchObject({ lastSeq: 3n, elementCount: 0 });
  });

  it('caps a board at 5 000 elements (updates still allowed)', async () => {
    const l = await live();
    const el = arrow(l.f.boardId, l.layerIds[0]!);
    await ack(l.editor, 'element:upsert', { opId: opId(), boardId: l.f.boardId, element: el });
    await prisma.board.update({ where: { id: l.f.boardId }, data: { elementCount: 5000 } });
    const res = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, l.layerIds[0]!),
    });
    expect(res).toMatchObject({ ok: false, code: 'LIMIT_REACHED' });
    const update = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: { ...el, z: 5 },
    });
    expect(update.ok).toBe(true);
  });

  it('element:batch is all-or-nothing and limited to 50 ops', async () => {
    const l = await live();
    const ops = [0, 1, 2].map(() => ({
      opId: opId(),
      kind: 'upsert',
      element: arrow(l.f.boardId, l.layerIds[0]!),
    }));
    const ok = await ack(l.editor, 'element:batch', { boardId: l.f.boardId, ops });
    expect(ok).toEqual({ ok: true, data: { seqs: [1, 2, 3] } });

    await prisma.layer.update({ where: { id: l.layerIds[2]! }, data: { locked: true } });
    const mixed = [
      { opId: opId(), kind: 'upsert', element: arrow(l.f.boardId, l.layerIds[0]!) },
      { opId: opId(), kind: 'upsert', element: arrow(l.f.boardId, l.layerIds[2]!) }, // locked
    ];
    expect(
      await ack(l.editor, 'element:batch', { boardId: l.f.boardId, ops: mixed }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await boardRow(l.f.boardId)).toMatchObject({ lastSeq: 3n, elementCount: 3 });

    const tooMany = Array.from({ length: 51 }, () => ({
      opId: opId(),
      kind: 'delete',
      elementId: opId(),
    }));
    expect(
      await ack(l.editor, 'element:batch', { boardId: l.f.boardId, ops: tooMany }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });
});

describe('layer ops', () => {
  it('upsert / reorder / clear / delete keep positions and element_count exact', async () => {
    const l = await live();
    const b = l.f.boardId;
    const newLayer = {
      id: opId(),
      name: 'Rotations',
      color: '#22C55E',
      visible: true,
      locked: false,
    };
    expect(
      (await ack(l.editor, 'layer:upsert', { opId: opId(), boardId: b, layer: newLayer })).ok,
    ).toBe(true);
    expect((await prisma.layer.findUniqueOrThrow({ where: { id: newLayer.id } })).position).toBe(3);

    const all = [...l.layerIds, newLayer.id];
    const reversed = [...all].reverse();
    expect(
      (await ack(l.editor, 'layer:reorder', { opId: opId(), boardId: b, order: reversed })).ok,
    ).toBe(true);
    const positions = await prisma.layer.findMany({
      where: { boardId: b },
      orderBy: { position: 'asc' },
    });
    expect(positions.map((p) => p.id)).toEqual(reversed);
    expect(
      await ack(l.editor, 'layer:reorder', { opId: opId(), boardId: b, order: all.slice(1) }),
    ).toMatchObject({ ok: false, code: 'BAD_REQUEST' });

    for (const layerId of [newLayer.id, newLayer.id, l.layerIds[0]!]) {
      await ack(l.editor, 'element:upsert', {
        opId: opId(),
        boardId: b,
        element: arrow(b, layerId),
      });
    }
    expect((await boardRow(b)).elementCount).toBe(3);
    expect(
      (await ack(l.editor, 'layer:clear', { opId: opId(), boardId: b, layerId: newLayer.id })).ok,
    ).toBe(true);
    expect((await boardRow(b)).elementCount).toBe(1);
    expect(
      (await ack(l.editor, 'layer:delete', { opId: opId(), boardId: b, layerId: l.layerIds[0]! }))
        .ok,
    ).toBe(true);
    expect((await boardRow(b)).elementCount).toBe(0);
    expect(await prisma.layer.count({ where: { boardId: b } })).toBe(3);
  });

  it('lock/unlock and editing a locked layer are OWNER-only; editors keep the rest', async () => {
    const l = await live();
    const b = l.f.boardId;
    const layer = (over: Record<string, unknown>) => ({
      id: l.layerIds[0],
      name: 'Plan',
      color: '#F2A900',
      visible: true,
      locked: false,
      ...over,
    });
    const upsert = (s: ClientSocket, over: Record<string, unknown>) =>
      ack(s, 'layer:upsert', { opId: opId(), boardId: b, layer: layer(over) });
    // editors: rename / recolor unlocked layers fine, locking forbidden
    expect((await upsert(l.editor, { name: 'Drops', color: '#38BDF8' })).ok).toBe(true);
    expect(await upsert(l.editor, { locked: true })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    const newLocked = await ack(l.editor, 'layer:upsert', {
      opId: opId(),
      boardId: b,
      layer: { id: opId(), name: 'Mine', color: '#22C55E', visible: true, locked: true },
    });
    expect(newLocked).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    // owner locks; editors can no longer rename or delete it
    expect((await upsert(l.owner, { locked: true })).ok).toBe(true);
    expect(await upsert(l.editor, { locked: true, name: 'Hijack' })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(
      await ack(l.editor, 'layer:delete', { opId: opId(), boardId: b, layerId: l.layerIds[0] }),
    ).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    // reordering stays an editor action, even with a locked layer in the list
    expect(
      (
        await ack(l.editor, 'layer:reorder', {
          opId: opId(),
          boardId: b,
          order: [...l.layerIds].reverse(),
        })
      ).ok,
    ).toBe(true);
    // owner unlocks / deletes
    expect((await upsert(l.owner, { locked: false })).ok).toBe(true);
    expect(
      (await ack(l.owner, 'layer:delete', { opId: opId(), boardId: b, layerId: l.layerIds[0] })).ok,
    ).toBe(true);
  });

  it("can't delete the last layer or exceed 10 layers", async () => {
    const l = await live();
    const b = l.f.boardId;
    await ack(l.editor, 'layer:delete', { opId: opId(), boardId: b, layerId: l.layerIds[0]! });
    await ack(l.editor, 'layer:delete', { opId: opId(), boardId: b, layerId: l.layerIds[1]! });
    expect(
      await ack(l.editor, 'layer:delete', { opId: opId(), boardId: b, layerId: l.layerIds[2]! }),
    ).toMatchObject({ ok: false, code: 'CONFLICT' });
    for (let i = 0; i < 9; i++) {
      const r = await ack(l.editor, 'layer:upsert', {
        opId: opId(),
        boardId: b,
        layer: { id: opId(), name: `L${i}`, color: '#22C55E', visible: true, locked: false },
      });
      expect(r.ok).toBe(true);
    }
    const eleventh = await ack(l.editor, 'layer:upsert', {
      opId: opId(),
      boardId: b,
      layer: { id: opId(), name: 'L11', color: '#22C55E', visible: true, locked: false },
    });
    expect(eleventh).toMatchObject({ ok: false, code: 'LIMIT_REACHED' });
  });
});

describe('resync (ARCHITECTURE §7.4)', () => {
  it('delta when sinceSeq is still in the op log, full when it is not', async () => {
    const l = await live();
    for (let i = 0; i < 3; i++) {
      await ack(l.editor, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: arrow(l.f.boardId, l.layerIds[0]!),
      });
    }
    const delta = await ack(l.owner, 'board:subscribe', { boardId: l.f.boardId, sinceSeq: 1 });
    expect(delta.data.mode).toBe('delta');
    expect(delta.data.seq).toBe(3);
    expect(delta.data.ops.map((o: { seq: number }) => o.seq)).toEqual([2, 3]);
    const upToDate = await ack(l.owner, 'board:subscribe', { boardId: l.f.boardId, sinceSeq: 3 });
    expect(upToDate.data).toEqual({ mode: 'delta', ops: [], seq: 3 });

    await prisma.boardOp.deleteMany({ where: { boardId: l.f.boardId, seq: { lte: 2 } } }); // pruned
    const full = await ack(l.owner, 'board:subscribe', { boardId: l.f.boardId, sinceSeq: 1 });
    expect(full.data.mode).toBe('full');
    expect(full.data.elements).toHaveLength(3);
    expect(full.data.seq).toBe(3);
    expect(
      (await ack(l.owner, 'board:subscribe', { boardId: l.f.boardId, sinceSeq: 99 })).data.mode,
    ).toBe('full');
  });

  it('switching boards leaves the previous board channel', async () => {
    const l = await live();
    const second = await call(app, l.f.owner.jar, 'POST', `/api/v1/rooms/${l.f.roomId}/boards`, {
      name: 'B2',
      mapId: 'rondo',
    });
    const b2 = second.json<{ board: { id: string } }>().board.id;
    await ack(l.owner, 'board:subscribe', { boardId: b2 });
    const toOwner = collect(l.owner, 'board:op');
    await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, l.layerIds[0]!),
    });
    await sleep(150);
    expect(toOwner).toEqual([]);
  });
});

describe('presence (ARCHITECTURE §7.6)', () => {
  it('counts tabs once, keeps distinct colours, tracks the board and idle flag', async () => {
    const f = await setupRoom(app);
    const tab1 = await connect(url, f.owner.jar);
    const tab2 = await connect(url, f.owner.jar);
    const editor = await connect(url, f.editor.jar);
    await ack(tab1, 'room:join', { roomId: f.roomId });
    await ack(tab2, 'room:join', { roomId: f.roomId });
    const updates = collect<{
      users: { userId: string; color: string; idle: boolean; boardId: string | null }[];
    }>(tab1, 'presence:update');
    await ack(editor, 'room:join', { roomId: f.roomId });
    await ack(editor, 'board:subscribe', { boardId: f.boardId });
    await sleep(150);
    let users = updates.at(-1)!.users;
    expect(users).toHaveLength(2);
    expect(new Set(users.map((u) => u.color)).size).toBe(2);
    expect(users.find((u) => u.userId === f.editor.id)?.boardId).toBe(f.boardId);

    await ack(editor, 'presence:heartbeat', { roomId: f.roomId, boardId: f.boardId, idle: true });
    await sleep(100);
    expect(updates.at(-1)!.users.find((u) => u.userId === f.editor.id)?.idle).toBe(true);

    tab2.disconnect();
    await sleep(200);
    users = updates.at(-1)!.users;
    expect(users.map((u) => u.userId).sort()).toEqual([f.owner.id, f.editor.id].sort()); // still online in tab1
    editor.disconnect();
    await sleep(200);
    expect(updates.at(-1)!.users.map((u) => u.userId)).toEqual([f.owner.id]);
  });
});

describe('ephemeral events (volatile)', () => {
  it('cursor and laser go to the board channel only, tagged with the sender', async () => {
    const l = await live();
    const cursor = nextEvent(l.owner, 'cursor:batch');
    l.viewer.emit('cursor:move', { boardId: l.f.boardId, x: 1000, y: 2000 });
    expect(await cursor).toEqual({
      boardId: l.f.boardId,
      cursors: [{ userId: l.f.viewer.id, x: 1000, y: 2000 }],
    });
    const laser = nextEvent(l.editor, 'laser:point');
    l.owner.emit('laser:point', { boardId: l.f.boardId, x: 5, y: 6 });
    expect(await laser).toMatchObject({ userId: l.f.owner.id, x: 5 });
  });

  it('stroke previews only flow from roles that can draw', async () => {
    const l = await live();
    const seen = collect(l.owner, 'stroke:preview');
    const preview = {
      boardId: l.f.boardId,
      tempId: opId(),
      points: [[1, 1]],
      style: arrow('', '').style,
    };
    l.viewer.emit('stroke:preview', preview as never);
    l.editor.emit('stroke:preview', preview as never);
    await sleep(200);
    expect(seen.map((s: { userId: string }) => s.userId)).toEqual([l.f.editor.id]);
  });

  it('view:update reaches followers only; summon needs OWNER/EDITOR', async () => {
    const l = await live();
    expect((await ack(l.owner, 'follow:start', { targetUserId: l.f.editor.id })).ok).toBe(true);
    const ownerViews = collect(l.owner, 'view:update');
    const viewerViews = collect(l.viewer, 'view:update');
    l.editor.emit('view:update', { boardId: l.f.boardId, center: [408_000, 408_000], zoom: 2 });
    await sleep(200);
    expect(ownerViews).toHaveLength(1);
    expect(viewerViews).toHaveLength(0);

    expect(await ack(l.viewer, 'summon', { boardId: l.f.boardId })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    const summoned = nextEvent(l.viewer, 'summon');
    expect((await ack(l.editor, 'summon', { boardId: l.f.boardId })).ok).toBe(true);
    expect(await summoned).toEqual({ userId: l.f.editor.id, boardId: l.f.boardId });
  });

  it('cursors are batched: one message per board per tick, the latest position per user', async () => {
    const l = await live();
    await sleep(CURSOR_FLUSH_MS * 2); // start on a fresh tick
    const seen = collect<{ cursors: { userId: string; x: number }[] }>(l.owner, 'cursor:batch');
    for (let x = 1; x <= 5; x++) l.editor.emit('cursor:move', { boardId: l.f.boardId, x, y: 1 });
    l.viewer.emit('cursor:move', { boardId: l.f.boardId, x: 99, y: 1 });
    await sleep(CURSOR_FLUSH_MS * 3);
    const all = seen.flatMap((b) => b.cursors);
    // far fewer messages than moves, and nothing older than the last move survives a flush
    expect(seen.length).toBeLessThanOrEqual(3);
    expect(all.filter((c) => c.userId === l.f.editor.id).at(-1)?.x).toBe(5);
    expect(all.find((c) => c.userId === l.f.viewer.id)?.x).toBe(99);
  });

  it('volatile spam is capped (≈40/s, rest dropped) and the server stays responsive', async () => {
    const l = await live();
    const seen = collect(l.owner, 'laser:point');
    // send far faster than the cap with no sleeps in between bursts of 20
    const started = Date.now();
    let sent = 0;
    while (Date.now() - started < 1000) {
      for (let i = 0; i < 20; i++, sent++)
        l.editor.emit('laser:point', { boardId: l.f.boardId, x: sent, y: sent });
      await sleep(10);
    }
    const elapsed = (Date.now() - started) / 1000;
    await sleep(300);
    expect(sent).toBeGreaterThan(400);
    expect(seen.length).toBeGreaterThan(0);
    // bucket: 40 burst + 40/s refill (socket.volatile may drop even more under load)
    expect(seen.length).toBeLessThanOrEqual(40 + Math.ceil(40 * elapsed) + 5);
    expect(
      (
        await ack(l.owner, 'presence:heartbeat', {
          roomId: l.f.roomId,
          boardId: l.f.boardId,
          idle: false,
        })
      ).ok,
    ).toBe(true);
  });
});

describe('rate limits & payload size (API_SPEC §7.4)', () => {
  it('floods of durable ops get RATE_LIMITED, then the abuser is disconnected', async () => {
    const l = await live();
    const disconnected = nextEvent(l.editor, 'disconnect', 10_000);
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        ack(l.editor, 'element:delete', {
          opId: opId(),
          boardId: l.f.boardId,
          elementId: opId(),
        }).catch(() => ({ ok: false, code: 'TIMEOUT' })),
      ),
    );
    expect(results.filter((r) => r.code === 'RATE_LIMITED').length).toBeGreaterThan(0);
    await disconnected;
    expect(l.editor.connected).toBe(false);
  });

  it('a message over 64 KB closes the connection', async () => {
    const l = await live();
    const disconnected = nextEvent(l.editor, 'disconnect', 5000);
    l.editor.emit(
      'element:upsert',
      {
        opId: opId(),
        boardId: l.f.boardId,
        element: arrow(l.f.boardId, l.layerIds[0]!, { props: { pad: 'x'.repeat(70_000) } }),
      } as never,
      () => undefined,
    );
    await disconnected;
    expect(await prisma.element.count()).toBe(0);
  });
});

describe('REST → realtime bridge', () => {
  it('kick: target gets member:kicked, is disconnected and cannot rejoin', async () => {
    const l = await live();
    const kickedNotice = nextEvent(l.editor, 'member:kicked');
    const disconnected = nextEvent(l.editor, 'disconnect');
    const roomNotice = nextEvent(l.owner, 'member:kicked');
    await call(
      app,
      l.f.owner.jar,
      'DELETE',
      `/api/v1/rooms/${l.f.roomId}/members/${l.f.editor.id}`,
    );
    expect(await kickedNotice).toEqual({ userId: l.f.editor.id });
    expect(await roomNotice).toEqual({ userId: l.f.editor.id });
    await disconnected;
    const again = await connect(url, l.f.editor.jar);
    expect(await ack(again, 'room:join', { roomId: l.f.roomId })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('a role downgrade applies on the very next event', async () => {
    const l = await live();
    const notice = nextEvent(l.owner, 'member:roleChanged');
    await call(
      app,
      l.f.owner.jar,
      'PATCH',
      `/api/v1/rooms/${l.f.roomId}/members/${l.f.editor.id}`,
      { role: 'VIEWER' },
    );
    expect(await notice).toEqual({ userId: l.f.editor.id, role: 'VIEWER' });
    const r = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, l.layerIds[0]!),
    });
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('board and room events reach the room channel; deleted boards stop accepting ops', async () => {
    const l = await live();
    const created = nextEvent<{ board: { id: string } }>(l.viewer, 'board:created');
    const res = await call(app, l.f.owner.jar, 'POST', `/api/v1/rooms/${l.f.roomId}/boards`, {
      name: 'B2',
      mapId: 'miramar',
    });
    const b2 = res.json<{ board: { id: string } }>().board.id;
    expect((await created).board.id).toBe(b2);
    const updated = nextEvent(l.viewer, 'room:updated');
    await call(app, l.f.owner.jar, 'PATCH', `/api/v1/rooms/${l.f.roomId}`, { name: 'Renamed' });
    expect(await updated).toMatchObject({ room: { name: 'Renamed' } });
    const deleted = nextEvent(l.viewer, 'board:deleted');
    await call(app, l.f.owner.jar, 'DELETE', `/api/v1/boards/${l.f.boardId}`);
    expect(await deleted).toEqual({ boardId: l.f.boardId });
    const r = await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, l.layerIds[0]!),
    });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('logout drops that session’s sockets; logout-all drops every session', async () => {
    const { jar } = await register(app);
    const second = await login(app, 'alice');
    const s1 = await connect(url, jar);
    const s2 = await connect(url, second.jar);
    const d1 = nextEvent(s1, 'disconnect');
    await call(app, jar, 'POST', '/api/v1/auth/logout');
    await d1;
    await sleep(100);
    expect(s2.connected).toBe(true);
    const third = await login(app, 'alice');
    const s3 = await connect(url, third.jar);
    const d2 = nextEvent(s2, 'disconnect');
    const d3 = nextEvent(s3, 'disconnect');
    await call(app, third.jar, 'POST', '/api/v1/auth/logout-all');
    await Promise.all([d2, d3]);
  });

  it('member:joined is broadcast when someone accepts an invite', async () => {
    const l = await live();
    const joined = nextEvent<{ member: { user: { id: string } } }>(l.owner, 'member:joined');
    const inv = await call(app, l.f.owner.jar, 'POST', `/api/v1/rooms/${l.f.roomId}/invites`, {
      expiresIn: '1h',
    });
    await call(
      app,
      l.f.outsider.jar,
      'POST',
      `/api/v1/invites/${inv.json<{ invite: { code: string } }>().invite.code}/accept`,
      {},
    );
    expect((await joined).member.user.id).toBe(l.f.outsider.id);
  });
});

describe('scale-out: two instances sharing Redis', () => {
  it('ops, room events and kicks cross instances through the Redis adapter', async () => {
    const { app: second } = await makeApp({ RATE_LIMITS_ENABLED: 'false' });
    const url2 = await listen(second);
    const f = await setupRoom(app);
    const owner = await connect(url, f.owner.jar); // instance 1
    const editor = await connect(url2, f.editor.jar); // instance 2
    const state = await joinBoard(owner, f.roomId, f.boardId);
    await joinBoard(editor, f.roomId, f.boardId);

    const op = nextEvent<{ seq: number }>(owner, 'board:op');
    const r = await ack(editor, 'element:upsert', {
      opId: opId(),
      boardId: f.boardId,
      element: arrow(f.boardId, state.layers[0]!.id),
    });
    expect(r.ok).toBe(true);
    expect((await op).seq).toBe(1);

    const cursor = nextEvent<{ cursors: { userId: string }[] }>(editor, 'cursor:batch');
    owner.emit('cursor:move', { boardId: f.boardId, x: 1, y: 2 });
    expect((await cursor).cursors).toMatchObject([{ userId: f.owner.id }]);

    // REST on instance 1 kicks a socket living on instance 2
    const kicked = nextEvent(editor, 'disconnect');
    await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/members/${f.editor.id}`);
    await kicked;
  });
});

describe('board duplicate & jobs', () => {
  it('duplicating a board copies its elements with new ids in one go', async () => {
    const l = await live();
    for (let i = 0; i < 3; i++) {
      await ack(l.editor, 'element:upsert', {
        opId: opId(),
        boardId: l.f.boardId,
        element: arrow(l.f.boardId, l.layerIds[i]!),
      });
    }
    const res = await call(app, l.f.owner.jar, 'POST', `/api/v1/rooms/${l.f.roomId}/boards`, {
      name: 'copy',
      mapId: 'erangel',
      duplicateFrom: l.f.boardId,
    });
    const copyId = res.json<{ board: { id: string; elementCount: number } }>().board.id;
    expect(res.json<{ board: { elementCount: number } }>().board.elementCount).toBe(3);
    const [src, dst] = await Promise.all(
      [l.f.boardId, copyId].map((id) =>
        prisma.element.findMany({ where: { boardId: id }, include: { layer: true } }),
      ),
    );
    expect(dst).toHaveLength(3);
    expect(dst!.every((e) => e.layer.boardId === copyId)).toBe(true);
    expect(dst!.some((e) => src!.some((s) => s.id === e.id))).toBe(false);
    const state = await call(app, l.f.viewer.jar, 'GET', `/api/v1/boards/${copyId}/state`);
    expect(state.json<{ elements: unknown[] }>().elements).toHaveLength(3);
  });

  it('prunes board_ops older than 24 h or beyond the last 1 000 per board', async () => {
    const l = await live();
    await ack(l.editor, 'element:upsert', {
      opId: opId(),
      boardId: l.f.boardId,
      element: arrow(l.f.boardId, l.layerIds[0]!),
    });
    await prisma.board.update({ where: { id: l.f.boardId }, data: { lastSeq: 1500 } });
    await prisma.boardOp.createMany({
      data: [
        { boardId: l.f.boardId, seq: 1400n, opId: opId(), kind: 'element:delete', payload: {} }, // recent & within last 1000
        {
          boardId: l.f.boardId,
          seq: 1450n,
          opId: opId(),
          kind: 'element:delete',
          payload: {},
          createdAt: new Date(Date.now() - 25 * 3600_000),
        }, // too old
      ],
    });
    const removed = await pruneBoardOps(prisma);
    expect(removed).toBe(2); // seq 1 (beyond last 1000) + the old one
    expect((await prisma.boardOp.findMany()).map((o) => o.seq)).toEqual([1400n]);
  });

  it('jobs run on exactly one leader', async () => {
    let runs = 0;
    const job = () =>
      withLeaderLock(redis, 'test-job', 5000, async () => {
        runs++;
        await sleep(100);
      });
    const results = await Promise.all([job(), job(), job()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(runs).toBe(1);
  });
});

describe('socket session expiry', () => {
  it('announces the token expiry and disconnects with TOKEN_EXPIRED after the grace period', async () => {
    const { app: short } = await makeApp({
      RATE_LIMITS_ENABLED: 'false',
      ACCESS_TOKEN_TTL_SEC: '2',
      SOCKET_TOKEN_GRACE_SEC: '1',
    });
    const shortUrl = await listen(short);
    const { jar } = await register(short);
    const started = Date.now();
    // attach listeners before the handshake completes: `session` is emitted on connection
    const socket: ClientSocket = ioClient(shortUrl, {
      path: '/realtime',
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { origin: APP_ORIGIN, cookie: cookieHeader(jar) },
    });
    const session = nextEvent<{ expiresAt: number }>(socket, 'session', 3000);
    const error = nextEvent<{ code: string }>(socket, 'error', 8000);
    const disconnected = nextEvent<string>(socket, 'disconnect', 8000);

    const { expiresAt } = await session;
    expect(expiresAt).toBeGreaterThan(started);
    expect(expiresAt).toBeLessThanOrEqual(started + 3000);
    expect(await error).toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(await disconnected).toBe('io server disconnect');
    const lifetime = Date.now() - started;
    expect(lifetime).toBeGreaterThan(1500); // ttl 2 s (second-granular exp) + grace 1 s
    expect(lifetime).toBeLessThan(5000);
    socket.disconnect();
  });
});
