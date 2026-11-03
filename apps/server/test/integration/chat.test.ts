import { randomUUID } from 'node:crypto';
import { DELETED_BODY, MAPS } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import {
  accept,
  ack,
  call,
  collect,
  connect,
  createRoom,
  invite,
  joinBoard,
  listen,
  makeApp,
  nextEvent,
  prisma,
  setupRoom,
  sleep,
  useCleanState,
  type ClientSocket,
  type RoomFixture,
} from './harness.js';

/** Chat & pings (FEATURES F9, API_SPEC §6–7, SECURITY V3/V4/§6). */

useCleanState();

let app: App;
let url: string;
let logs: { lines: string[] };
beforeAll(async () => {
  ({ app, logs } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
  url = await listen(app);
});

interface Msg {
  id: string;
  body: string;
  kind: string;
  deleted: boolean;
  clientId: string | null;
  author: { id: string } | null;
  ping: { boardId: string | null; x: number; y: number } | null;
}

async function room(): Promise<{ f: RoomFixture; owner: ClientSocket; editor: ClientSocket }> {
  const f = await setupRoom(app);
  const owner = await connect(url, f.owner.jar);
  const editor = await connect(url, f.editor.jar);
  await joinBoard(owner, f.roomId, f.boardId);
  await joinBoard(editor, f.roomId, f.boardId);
  return { f, owner, editor };
}

const send = (s: ClientSocket, roomId: string, body: string, extra: object = {}) =>
  ack(s, 'chat:send', { clientId: randomUUID(), roomId, body, ...extra });

/** wait until the room has a message matching `pred` (system messages are fire-and-forget) */
async function waitForMessage(
  roomId: string,
  pred: (m: { body: string; kind: string }) => boolean,
) {
  for (let i = 0; i < 40; i++) {
    const rows = await prisma.chatMessage.findMany({ where: { roomId } });
    const hit = rows.find(pred);
    if (hit) return hit;
    await sleep(50);
  }
  throw new Error('message not found');
}

describe('chat:send', () => {
  it('stores the cleaned body, acks the message and broadcasts it to the room', async () => {
    const { f, owner, editor } = await room();
    const seen = collect<{ message: Msg }>(owner, 'chat:message');
    // NFD é + BEL + surrounding blanks; \n is kept
    const res = await send(editor, f.roomId, '  é\u0007 go school\n  rotate north  ');
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const msg = res.data.message as Msg;
    expect(msg).toMatchObject({
      body: 'é go school\n  rotate north',
      kind: 'USER',
      deleted: false,
      author: { id: f.editor.id },
      ping: null,
    });
    await sleep(100);
    expect(seen.map((s) => s.message.id)).toEqual([msg.id]);
    const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(row.body).toBe(msg.body);
  });

  it('rejects empty (after trimming) and > 500 code points; 500 emoji are fine', async () => {
    const { f, editor } = await room();
    expect(await send(editor, f.roomId, '   \u0007  ')).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(await send(editor, f.roomId, 'x'.repeat(501))).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(await send(editor, f.roomId, '🎯'.repeat(500))).toMatchObject({ ok: true });
  });

  it('a resent clientId returns the stored message and is not stored or broadcast twice', async () => {
    const { f, owner, editor } = await room();
    const seen = collect(owner, 'chat:message');
    const clientId = randomUUID();
    const a = await ack(editor, 'chat:send', { clientId, roomId: f.roomId, body: 'once' });
    const b = await ack(editor, 'chat:send', { clientId, roomId: f.roomId, body: 'once' });
    expect(b.data.message.id).toBe(a.data.message.id);
    await sleep(100);
    expect(seen).toHaveLength(1);
    expect(await prisma.chatMessage.count({ where: { roomId: f.roomId, kind: 'USER' } })).toBe(1);
  });

  it('flood: the 6th message within 10 s → RATE_LIMITED (5 / 10 s per socket)', async () => {
    const { f, editor } = await room();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await send(editor, f.roomId, `spam ${i}`));
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('needs room:join first; outsiders cannot send', async () => {
    const f = await setupRoom(app);
    const viewer = await connect(url, f.viewer.jar);
    expect(await send(viewer, f.roomId, 'hi')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await joinBoard(viewer, f.roomId, f.boardId);
    expect(await send(viewer, f.roomId, 'viewers can chat')).toMatchObject({ ok: true });
  });
});

describe('chat:typing (Phase 11)', () => {
  it('relays { userId } to the rest of the room, not the sender, at most once per 2 s', async () => {
    const { f, owner, editor } = await room();
    const seenByOwner = collect<{ userId: string }>(owner, 'chat:typing');
    const seenByEditor = collect(editor, 'chat:typing');
    for (let i = 0; i < 5; i++) {
      editor.emit('chat:typing', { roomId: f.roomId });
      await sleep(100);
    }
    await sleep(200);
    expect(seenByOwner).toEqual([{ userId: f.editor.id }]);
    expect(seenByEditor).toEqual([]);
    await sleep(1_700); // the 2 s window has passed
    editor.emit('chat:typing', { roomId: f.roomId });
    await sleep(250);
    expect(seenByOwner).toHaveLength(2);
  });

  it('dropped before room:join, for another room and for invalid payloads', async () => {
    const { f, owner } = await room();
    const seen = collect(owner, 'chat:typing');
    const viewer = await connect(url, f.viewer.jar);
    viewer.emit('chat:typing', { roomId: f.roomId }); // not joined yet
    viewer.emit('chat:typing', { roomId: f.roomId, extra: 1 } as never);
    viewer.emit('chat:typing', { roomId: 'nope' });
    await sleep(300);
    expect(seen).toEqual([]);
    const other = await createRoom(app, f.owner.jar, { name: 'Elsewhere' });
    await joinBoard(viewer, f.roomId, f.boardId);
    viewer.emit('chat:typing', { roomId: other.room.id }); // a room it never joined
    await sleep(300);
    expect(seen).toEqual([]);
    viewer.emit('chat:typing', { roomId: f.roomId }); // viewers chat too
    await sleep(300);
    expect(seen).toHaveLength(1);
  });
});

describe('pings', () => {
  it('stores a ping on a board of this room', async () => {
    const { f, editor } = await room();
    const res = await send(editor, f.roomId, 'go here', {
      ping: { boardId: f.boardId, x: 408_000, y: 408_000 },
    });
    expect(res.data.message.ping).toEqual({ boardId: f.boardId, x: 408_000, y: 408_000 });
  });

  it('a ping pointing at another room’s board is rejected', async () => {
    const { f, editor } = await room();
    const other = await createRoom(app, f.outsider.jar, { name: 'Elsewhere' });
    const res = await send(editor, f.roomId, 'sneaky', {
      ping: { boardId: other.board.id, x: 10, y: 10 },
    });
    expect(res).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await prisma.chatMessage.count({ where: { roomId: f.roomId, kind: 'USER' } })).toBe(0);
  });

  it('a ping outside the board’s map is rejected (shape cap ≠ map bounds)', async () => {
    const { f, editor } = await room();
    const W = MAPS.erangel.worldSize;
    expect(
      await send(editor, f.roomId, 'off the map', {
        ping: { boardId: f.boardId, x: W + 1, y: 10 },
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(
      await send(editor, f.roomId, 'edge', { ping: { boardId: f.boardId, x: W, y: W } }),
    ).toMatchObject({ ok: true });
  });

  it('deleting the board keeps the message; its ping board becomes null', async () => {
    const { f, editor } = await room();
    const spare = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Spare',
      mapId: 'rondo',
    });
    const spareId = spare.json<{ board: { id: string } }>().board.id;
    const res = await send(editor, f.roomId, 'there', {
      ping: { boardId: spareId, x: 5, y: 5 },
    });
    await call(app, f.owner.jar, 'DELETE', `/api/v1/boards/${spareId}`);
    const list = await call(app, f.owner.jar, 'GET', `/api/v1/rooms/${f.roomId}/messages`);
    const msg = list.json<{ items: Msg[] }>().items.find((m) => m.id === res.data.message.id);
    expect(msg?.ping).toEqual({ boardId: null, x: 5, y: 5 });
  });
});

describe('GET /rooms/:roomId/messages', () => {
  it('pages newest first with a cursor: 50 by default, max 100', async () => {
    const f = await setupRoom(app);
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = newId();
      ids.push(id);
      await prisma.chatMessage.create({
        data: { id, roomId: f.roomId, authorId: f.owner.id, body: `m${i}`, clientId: randomUUID() },
      });
    }
    const base = `/api/v1/rooms/${f.roomId}/messages`;
    const p1 = (await call(app, f.viewer.jar, 'GET', base)).json<{
      items: Msg[];
      nextCursor: string | null;
    }>();
    // system messages from setup (2 joins) are older than these 120
    expect(p1.items.map((m) => m.body)).toEqual(
      Array.from({ length: 50 }, (_, i) => `m${119 - i}`),
    );
    expect(p1.nextCursor).toBe(ids[70]);
    const p2 = (await call(app, f.viewer.jar, 'GET', `${base}?before=${p1.nextCursor}`)).json<{
      items: Msg[];
      nextCursor: string | null;
    }>();
    expect(p2.items[0]?.body).toBe('m69');
    expect(p2.items).toHaveLength(50);
    const p3 = (
      await call(app, f.viewer.jar, 'GET', `${base}?before=${p2.nextCursor}&limit=100`)
    ).json<{ items: Msg[]; nextCursor: string | null }>();
    expect(p3.items.filter((m) => m.kind === 'USER').map((m) => m.body)).toEqual(
      Array.from({ length: 20 }, (_, i) => `m${19 - i}`),
    );
    expect(p3.nextCursor).toBeNull();
    expect((await call(app, f.viewer.jar, 'GET', `${base}?limit=101`)).statusCode).toBe(400);
    expect((await call(app, f.outsider.jar, 'GET', base)).statusCode).toBe(404);
  });

  it('XSS payloads are stored and returned verbatim, as data', async () => {
    const { f, editor } = await room();
    const payload = '<img src=x onerror=alert(1)> <script>alert("x")</script> &amp; "quotes"';
    await send(editor, f.roomId, payload);
    const res = await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${f.roomId}/messages`);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json<{ items: Msg[] }>().items[0]?.body).toBe(payload);
    expect(res.body).not.toContain('&lt;img'); // not HTML-escaped either: encoding is the UI's job
  });
});

describe('DELETE /messages/:messageId', () => {
  it('author or owner only; the body is replaced and chat:deleted broadcast', async () => {
    const { f, owner, editor } = await room();
    const m1 = (await send(editor, f.roomId, 'my plan')).data.message as Msg;
    const m2 = (await send(editor, f.roomId, 'second')).data.message as Msg;
    const path = (id: string) => `/api/v1/messages/${id}`;

    expect((await call(app, f.viewer.jar, 'DELETE', path(m1.id))).statusCode).toBe(403);
    expect((await call(app, f.outsider.jar, 'DELETE', path(m1.id))).statusCode).toBe(404);
    expect((await call(app, f.editor.jar, 'DELETE', path(randomUUID()))).statusCode).toBe(404);

    const deleted = nextEvent<{ messageId: string }>(owner, 'chat:deleted');
    expect((await call(app, f.editor.jar, 'DELETE', path(m1.id))).statusCode).toBe(204);
    expect(await deleted).toEqual({ messageId: m1.id });
    expect((await call(app, f.owner.jar, 'DELETE', path(m2.id))).statusCode).toBe(204);
    expect((await call(app, f.owner.jar, 'DELETE', path(m2.id))).statusCode).toBe(204); // idempotent

    const items = (await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${f.roomId}/messages`))
      .json<{ items: Msg[] }>()
      .items.filter((m) => m.kind === 'USER');
    expect(items.map((m) => [m.body, m.deleted])).toEqual([
      [DELETED_BODY, true],
      [DELETED_BODY, true],
    ]);
    const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: m1.id } });
    expect(row.body).toBe(DELETED_BODY); // overwritten, not kept
  });
});

describe('system messages', () => {
  it('join, role change, board created / deleted, kick — broadcast to the room', async () => {
    const f = await setupRoom(app);
    const owner = await connect(url, f.owner.jar);
    await joinBoard(owner, f.roomId, f.boardId);
    const seen = collect<{ message: Msg }>(owner, 'chat:message');

    await waitForMessage(f.roomId, (m) => m.body === 'editor joined the room');
    await call(app, f.owner.jar, 'PATCH', `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}`, {
      role: 'EDITOR',
    });
    await waitForMessage(f.roomId, (m) => m.body === 'viewer is now an Editor');
    const board = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Miramar – Drop B',
      mapId: 'miramar',
    });
    await waitForMessage(f.roomId, (m) => m.body === 'Board “Miramar – Drop B” was created');
    await call(
      app,
      f.owner.jar,
      'DELETE',
      `/api/v1/boards/${board.json<{ board: { id: string } }>().board.id}`,
    );
    await waitForMessage(f.roomId, (m) => m.body === 'Board “Miramar – Drop B” was deleted');
    await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/members/${f.editor.id}`);
    const kick = await waitForMessage(
      f.roomId,
      (m) => m.body === 'editor was removed from the room',
    );
    expect(kick).toMatchObject({ kind: 'SYSTEM', authorId: null, clientId: null });
    await sleep(100);
    expect(seen.map((s) => s.message.body)).toEqual([
      'viewer is now an Editor',
      'Board “Miramar – Drop B” was created',
      'Board “Miramar – Drop B” was deleted',
      'editor was removed from the room',
    ]);
  });

  it('leave via REST and join via invite', async () => {
    const f = await setupRoom(app);
    await call(app, f.viewer.jar, 'POST', `/api/v1/rooms/${f.roomId}/leave`);
    await waitForMessage(f.roomId, (m) => m.body === 'viewer left the room');
    const inv = await invite(app, f.owner.jar, f.roomId);
    await accept(app, f.outsider.jar, inv.code);
    await waitForMessage(f.roomId, (m) => m.body === 'outsider joined the room');
  });
});

describe('privacy', () => {
  it('chat bodies never reach the logs', async () => {
    const { f, editor } = await room();
    const secret = `rotate-to-${randomUUID()}`;
    await send(editor, f.roomId, secret);
    await send(editor, f.roomId, 'x'.repeat(501) + secret); // a rejected one too
    await call(app, f.owner.jar, 'GET', `/api/v1/rooms/${f.roomId}/messages`);
    await sleep(100);
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(logs.lines.join('\n')).not.toContain(secret);
  });
});
