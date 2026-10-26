import { randomUUID } from 'node:crypto';
import { SNAPSHOT_LIMITS } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import {
  ack,
  arrow,
  call,
  connect,
  createRoom,
  joinBoard,
  listen,
  makeApp,
  opId,
  prisma,
  setupRoom,
  sleep,
  useCleanState,
  type RoomFixture,
} from './harness.js';

/** Snapshots (FEATURES F10, API_SPEC §5, DATABASE_SCHEMA §3.11 / §6, UF-11). */

useCleanState();

let app: App;
let url: string;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
  url = await listen(app);
});

interface Snap {
  id: string;
  name: string;
  isAuto: boolean;
  elementCount: number;
  createdBy: { id: string } | null;
}

async function boardWith(n: number) {
  const f = await setupRoom(app);
  const owner = await connect(url, f.owner.jar);
  const state = await joinBoard(owner, f.roomId, f.boardId);
  const layerId = state.layers[0]!.id;
  const els = Array.from({ length: n }, (_, i) =>
    arrow(f.boardId, layerId, {
      geometry: {
        points: [
          [1000 + i, 1000],
          [2000 + i, 3000],
        ],
      },
    }),
  );
  for (let i = 0; i < els.length; i += 50) {
    const r = await ack(owner, 'element:batch', {
      boardId: f.boardId,
      ops: els.slice(i, i + 50).map((element) => ({ opId: opId(), kind: 'upsert', element })),
    });
    if (!r.ok) throw new Error(`batch ${r.code}`);
  }
  return { f, owner, layerId, els, state };
}

const snap = (f: RoomFixture, jar: RoomFixture['owner']['jar'], name: string) =>
  call(app, jar, 'POST', `/api/v1/boards/${f.boardId}/snapshots`, { name });

async function boardState(boardId: string) {
  const b = await prisma.board.findUniqueOrThrow({ where: { id: boardId } });
  const layers = await prisma.layer.findMany({ where: { boardId }, orderBy: { position: 'asc' } });
  const elements = await prisma.element.findMany({ where: { boardId }, orderBy: { id: 'asc' } });
  return {
    lastSeq: Number(b.lastSeq),
    elementCount: b.elementCount,
    layers: layers.map((l) => [l.id, l.name, l.position]),
    elements: elements.map((e) => [e.id, e.layerId, JSON.stringify(e.geometry)]),
  };
}

describe('snapshot CRUD & permissions', () => {
  it('editors save; members list (newest first) and read data; viewers cannot save', async () => {
    const { f, els } = await boardWith(3);
    const a = await snap(f, f.editor.jar, 'Plan A – north zone');
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json<{ snapshot: Snap }>().snapshot).toMatchObject({
      name: 'Plan A – north zone',
      isAuto: false,
      elementCount: 3,
      createdBy: { id: f.editor.id },
    });
    expect((await snap(f, f.viewer.jar, 'nope')).statusCode).toBe(403);
    expect((await snap(f, f.outsider.jar, 'nope')).statusCode).toBe(404);
    expect((await snap(f, f.editor.jar, 'x'.repeat(61))).statusCode).toBe(400);
    expect((await snap(f, f.editor.jar, '   ')).statusCode).toBe(400);
    await sleep(5);
    await snap(f, f.owner.jar, 'Plan B');

    const list = await call(app, f.viewer.jar, 'GET', `/api/v1/boards/${f.boardId}/snapshots`);
    expect(list.json<{ items: Snap[] }>().items.map((s) => s.name)).toEqual([
      'Plan B',
      'Plan A – north zone',
    ]);
    const id = a.json<{ snapshot: Snap }>().snapshot.id;
    const detail = await call(app, f.viewer.jar, 'GET', `/api/v1/snapshots/${id}`);
    const data = detail.json<{
      data: { version: number; layers: unknown[]; elements: { id: string }[] };
    }>().data;
    expect(data.version).toBe(1);
    expect(data.layers).toHaveLength(3);
    expect(data.elements.map((e) => e.id).sort()).toEqual(els.map((e) => e.id).sort());
    expect((await call(app, f.outsider.jar, 'GET', `/api/v1/snapshots/${id}`)).statusCode).toBe(
      404,
    );
  });

  it('delete: the author or the owner; others 403', async () => {
    const { f } = await boardWith(1);
    const byEditor = (await snap(f, f.editor.jar, 'mine')).json<{ snapshot: Snap }>().snapshot.id;
    const byOwner = (await snap(f, f.owner.jar, 'theirs')).json<{ snapshot: Snap }>().snapshot.id;
    const del = (jar: RoomFixture['owner']['jar'], id: string) =>
      call(app, jar, 'DELETE', `/api/v1/snapshots/${id}`);
    expect((await del(f.viewer.jar, byEditor)).statusCode).toBe(403);
    expect((await del(f.editor.jar, byOwner)).statusCode).toBe(403);
    expect((await del(f.editor.jar, byEditor)).statusCode).toBe(204);
    expect((await del(f.owner.jar, byOwner)).statusCode).toBe(204);
    expect((await del(f.owner.jar, byOwner)).statusCode).toBe(404);
  });

  it('50 manual snapshots per board: the 51st → LIMIT_REACHED until one is deleted', async () => {
    const { f } = await boardWith(1);
    const data = { version: 1, layers: [], elements: [] };
    await prisma.snapshot.createMany({
      data: Array.from({ length: SNAPSHOT_LIMITS.manualPerBoard }, (_, i) => ({
        id: newId(),
        boardId: f.boardId,
        name: `s${i}`,
        data,
        elementCount: 0,
      })),
    });
    const full = await snap(f, f.editor.jar, 'one too many');
    expect(full.statusCode).toBe(422);
    expect(full.json<{ error: { code: string } }>().error.code).toBe('LIMIT_REACHED');
    // auto snapshots don't count toward the manual limit
    await prisma.snapshot.deleteMany({ where: { boardId: f.boardId, name: 's0' } });
    expect((await snap(f, f.editor.jar, 'fits again')).statusCode).toBe(201);
  });

  it('a system message announces a saved snapshot', async () => {
    const { f } = await boardWith(1);
    await snap(f, f.editor.jar, 'Drop plan');
    await app.chatIdle();
    const msgs = await prisma.chatMessage.findMany({ where: { roomId: f.roomId, kind: 'SYSTEM' } });
    expect(msgs.map((m) => m.body)).toContain("editor saved snapshot 'Drop plan'");
  });
});

describe('restore', () => {
  it('replaces the state (ids kept), auto-snapshots first, resets seq & count, audits, then emits board:reset', async () => {
    const { f, owner, layerId, els } = await boardWith(4);
    const saved = (await snap(f, f.editor.jar, 'Plan A')).json<{ snapshot: Snap }>().snapshot;
    const before = await boardState(f.boardId);

    // modify: delete one, add two, rename a layer
    await ack(owner, 'element:delete', { opId: opId(), boardId: f.boardId, elementId: els[0]!.id });
    for (let i = 0; i < 2; i++)
      await ack(owner, 'element:upsert', {
        opId: opId(),
        boardId: f.boardId,
        element: arrow(f.boardId, layerId),
      });
    const editor = await connect(url, f.editor.jar);
    await joinBoard(editor, f.roomId, f.boardId);
    const modifiedSeq = (await boardState(f.boardId)).lastSeq;

    // board:reset is emitted only after commit: the DB already holds the restored state then
    const reset = new Promise<{
      ev: { boardId: string; seq: number; reason: string; actorId: string };
      state: Awaited<ReturnType<typeof boardState>>;
    }>((resolve) => {
      (editor as unknown as { once: (e: string, f: (p: never) => void) => void }).once(
        'board:reset',
        (ev: { boardId: string; seq: number; reason: string; actorId: string }) => {
          void boardState(f.boardId).then((state) => {
            resolve({ ev, state });
          });
        },
      );
    });
    const res = await call(app, f.editor.jar, 'POST', `/api/v1/snapshots/${saved.id}/restore`);
    expect(res.statusCode, res.body).toBe(200);
    const { seq } = res.json<{ seq: number }>();
    expect(seq).toBe(modifiedSeq + 1);
    const { ev, state } = await reset;
    expect(ev).toEqual({
      boardId: f.boardId,
      seq,
      reason: 'snapshot_restore',
      actorId: f.editor.id,
    });
    expect(state.elements).toEqual(before.elements); // same ids, same geometry
    expect(state.layers).toEqual(before.layers);
    expect(state.elementCount).toBe(4);
    expect(state.lastSeq).toBe(seq);

    // the auto snapshot holds the modified state (5 elements)
    const auto = await prisma.snapshot.findFirstOrThrow({
      where: { boardId: f.boardId, isAuto: true },
    });
    expect(auto).toMatchObject({
      name: "Before restore of 'Plan A'",
      elementCount: 5,
      createdBy: f.editor.id,
    });
    // audit row, op log dropped (a delta resync across the reset is impossible → full load)
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'snapshot.restore', targetId: saved.id },
      }),
    ).toMatchObject({
      actorId: f.editor.id,
      roomId: f.roomId,
    });
    expect(await prisma.boardOp.count({ where: { boardId: f.boardId } })).toBe(0);
    const resub = await ack(owner, 'board:subscribe', {
      boardId: f.boardId,
      sinceSeq: modifiedSeq,
    });
    expect(resub.data.mode).toBe('full');
    await app.chatIdle();
    const sys = await prisma.chatMessage.findMany({ where: { roomId: f.roomId, kind: 'SYSTEM' } });
    expect(sys.map((m) => m.body)).toContain("editor restored snapshot 'Plan A'");

    // viewers can't restore
    expect(
      (await call(app, f.viewer.jar, 'POST', `/api/v1/snapshots/${saved.id}/restore`)).statusCode,
    ).toBe(403);
  });

  it('atomic: a failure mid-transaction leaves everything as it was', async () => {
    const { f, owner, els } = await boardWith(2);
    const saved = (await snap(f, f.owner.jar, 'Plan A')).json<{ snapshot: Snap }>().snapshot;
    // delete els[0] here and re-use its id on another board: the restore's insert collides
    // after the deletes and the auto snapshot already ran inside the transaction
    await ack(owner, 'element:delete', { opId: opId(), boardId: f.boardId, elementId: els[0]!.id });
    const other = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Other',
      mapId: 'erangel',
    });
    const otherId = other.json<{ board: { id: string } }>().board.id;
    const otherState = await joinBoard(owner, f.roomId, otherId);
    const clash = await ack(owner, 'element:upsert', {
      opId: opId(),
      boardId: otherId,
      element: arrow(otherId, otherState.layers[0]!.id, { id: els[0]!.id }),
    });
    expect(clash.ok).toBe(true);

    const before = await boardState(f.boardId);
    const snapsBefore = await prisma.snapshot.count({ where: { boardId: f.boardId } });
    const res = await call(app, f.owner.jar, 'POST', `/api/v1/snapshots/${saved.id}/restore`);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await boardState(f.boardId)).toEqual(before);
    expect(await prisma.snapshot.count({ where: { boardId: f.boardId } })).toBe(snapsBefore); // no auto
    expect(await prisma.auditLog.count({ where: { action: 'snapshot.restore' } })).toBe(0);
    expect(await prisma.boardOp.count({ where: { boardId: f.boardId } })).toBeGreaterThan(0);
  });

  it('auto snapshots: at most 10 per board, the oldest pruned — never the one being restored', async () => {
    const { f } = await boardWith(1);
    const data = (
      await call(
        app,
        f.owner.jar,
        'GET',
        `/api/v1/snapshots/${(await snap(f, f.owner.jar, 'base')).json<{ snapshot: Snap }>().snapshot.id}`,
      )
    ).json<{ data: object }>().data;
    const t0 = Date.now() - 60 * 60_000;
    const autos = Array.from({ length: 10 }, (_, i) => ({
      id: newId(),
      boardId: f.boardId,
      name: `auto ${i}`,
      isAuto: true,
      data,
      elementCount: 1,
      createdAt: new Date(t0 + i * 1000),
    }));
    await prisma.snapshot.createMany({ data: autos });
    // restore the oldest auto: a new auto is taken; the oldest would be pruned but is kept
    const res = await call(app, f.owner.jar, 'POST', `/api/v1/snapshots/${autos[0]!.id}/restore`);
    expect(res.statusCode, res.body).toBe(200);
    const left = await prisma.snapshot.findMany({
      where: { boardId: f.boardId, isAuto: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(left).toHaveLength(10); // the protected one counts toward the 10
    expect(left.map((s) => s.name)).toContain('auto 0');
    expect(left.map((s) => s.name)).not.toContain('auto 1'); // the oldest unprotected one went
    // a plain restore of a manual snapshot now prunes down to 10
    const manual = (
      await prisma.snapshot.findFirstOrThrow({ where: { boardId: f.boardId, name: 'base' } })
    ).id;
    await call(app, f.owner.jar, 'POST', `/api/v1/snapshots/${manual}/restore`);
    expect(await prisma.snapshot.count({ where: { boardId: f.boardId, isAuto: true } })).toBe(10);
  });
});

describe('layer:clear auto snapshot', () => {
  it('any non-empty layer: auto snapshot of the whole board first + a system message', async () => {
    const { f, owner, layerId, state } = await boardWith(3);
    const res = await ack(owner, 'layer:clear', { opId: opId(), boardId: f.boardId, layerId });
    expect(res.ok).toBe(true);
    const auto = await prisma.snapshot.findFirstOrThrow({
      where: { boardId: f.boardId, isAuto: true },
    });
    expect(auto.name).toBe(`Before clearing '${state.layers[0]!.name}'`);
    expect(auto.elementCount).toBe(3);
    expect(await prisma.element.count({ where: { boardId: f.boardId } })).toBe(0);
    await app.chatIdle();
    const sys = await prisma.chatMessage.findMany({ where: { roomId: f.roomId, kind: 'SYSTEM' } });
    expect(
      sys.some((m) =>
        m.body.startsWith(`owner cleared layer '${state.layers[0]!.name}' (3 elements)`),
      ),
    ).toBe(true);

    // the clear is undoable: restoring the auto snapshot brings all 3 back
    const r = await call(app, f.owner.jar, 'POST', `/api/v1/snapshots/${auto.id}/restore`);
    expect(r.statusCode).toBe(200);
    expect(await prisma.element.count({ where: { boardId: f.boardId } })).toBe(3);
  });

  it('an empty layer: nothing to save, no snapshot and no system message', async () => {
    const empty = await boardWith(0);
    const res = await ack(empty.owner, 'layer:clear', {
      opId: opId(),
      boardId: empty.f.boardId,
      layerId: empty.layerId,
    });
    expect(res.ok).toBe(true);
    expect(await prisma.snapshot.count({ where: { boardId: empty.f.boardId } })).toBe(0);
    await app.chatIdle();
    const sys = await prisma.chatMessage.findMany({
      where: { roomId: empty.f.roomId, kind: 'SYSTEM' },
    });
    expect(sys.some((m) => m.body.includes('cleared layer'))).toBe(false);
  });
});

describe('IDOR', () => {
  it('snapshots of another room are 404 for every route', async () => {
    const a = await boardWith(1);
    await createRoom(app, a.f.outsider.jar, { name: 'Elsewhere' }); // an owner of another room
    const b = { owner: a.f.outsider };
    const id = (await snap(a.f, a.f.owner.jar, 'secret')).json<{ snapshot: Snap }>().snapshot.id;
    for (const [method, path] of [
      ['GET', `/api/v1/snapshots/${id}`],
      ['POST', `/api/v1/snapshots/${id}/restore`],
      ['DELETE', `/api/v1/snapshots/${id}`],
      ['GET', `/api/v1/boards/${a.f.boardId}/snapshots`],
    ] as const)
      expect((await call(app, b.owner.jar, method, path)).statusCode, path).toBe(404);
    expect(
      (await call(app, a.f.owner.jar, 'GET', `/api/v1/snapshots/${randomUUID()}`)).statusCode,
    ).toBe(404);
  });
});
