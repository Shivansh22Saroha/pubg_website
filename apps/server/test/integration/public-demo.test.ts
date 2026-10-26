import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import type { Jar } from './harness.js';
import {
  call,
  createRoom,
  login,
  makeApp,
  prisma,
  register,
  setupRoom,
  useCleanState,
} from './harness.js';

/** `GET /public/demo-boards` (FEATURES F13) and `PATCH /me/prefs` (Phase 9 onboarding). */

useCleanState();

let app: App; // DEMO_BOARD_IDS unset; also builds the fixtures
beforeAll(async () => {
  ({ app } = await makeApp());
});

const demo = (a: App) => a.inject({ method: 'GET', url: '/api/v1/public/demo-boards' });

/** one element on the board's first layer, written straight to the DB */
async function addElement(boardId: string, authorId: string) {
  const layer = await prisma.layer.findFirstOrThrow({ where: { boardId } });
  await prisma.element.create({
    data: {
      id: newId(),
      boardId,
      layerId: layer.id,
      type: 'MARKER',
      geometry: { at: [400_000, 400_000] },
      style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 },
      props: { kind: 'enemy_squad', number: 1 },
      seq: 1n,
      createdBy: authorId,
      updatedBy: authorId,
    },
  });
}

describe('GET /public/demo-boards', () => {
  it('unset → an empty list, still public and cacheable', async () => {
    await setupRoom(app); // real boards exist, none is a demo board
    const res = await demo(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('serves only the listed boards, in env order, without room or author ids', async () => {
    const f = await setupRoom(app);
    const second = (await createRoom(app, f.owner.jar, { name: 'Other' })).board.id;
    await addElement(f.boardId, f.owner.id);
    const missing = '0192f7a1-0000-7000-8000-00000000dead';
    const { app: withDemo } = await makeApp({
      DEMO_BOARD_IDS: `${second}, ${missing},${f.boardId}`,
    });

    const res = await demo(withDemo);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    const body = res.json<{
      items: {
        board: Record<string, unknown>;
        layers: unknown[];
        elements: { createdBy: unknown }[];
      }[];
    }>();
    expect(body.items.map((i) => i.board.id)).toEqual([second, f.boardId]);
    expect(body.items[1]!.layers).toHaveLength(3);
    expect(body.items[1]!.elements).toHaveLength(1);
    expect(body.items[1]!.elements[0]).toMatchObject({ createdBy: null, updatedBy: null });
    expect(body.items[0]!.board).not.toHaveProperty('roomId');
    for (const secret of [f.roomId, f.owner.id, f.editor.id])
      expect(res.body).not.toContain(secret);
  });

  it('a non-demo board id is never served, whatever the request says', async () => {
    const f = await setupRoom(app);
    const other = await setupRoomElsewhere(f.owner.jar);
    const { app: withDemo } = await makeApp({ DEMO_BOARD_IDS: f.boardId });
    for (const url of [
      `/api/v1/public/demo-boards?boardId=${other}`,
      `/api/v1/public/demo-boards?ids=${other}`,
      `/api/v1/public/demo-boards/${other}`,
    ]) {
      const res = await withDemo.inject({ method: 'GET', url });
      expect(res.body).not.toContain(other);
    }
    // and the board of a deleted room disappears from the list
    await prisma.room.update({ where: { id: f.roomId }, data: { deletedAt: new Date() } });
    expect((await demo(withDemo)).json()).toEqual({ items: [] });
  });

  it('rate limit: 30 / min / IP, then 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await demo(app)).statusCode);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
    // another IP is unaffected
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/public/demo-boards',
      remoteAddress: '10.9.8.7',
    });
    expect(other.statusCode).toBe(200);
  });
});

async function setupRoomElsewhere(jar: Jar) {
  return (await createRoom(app, jar, { name: 'Not a demo' })).board.id;
}

describe('PATCH /me/prefs', () => {
  it('defaults, merges, and follows the user to another device', async () => {
    const { jar } = await register(app);
    const me = await call(app, jar, 'GET', '/api/v1/me');
    expect(me.json<{ user: { prefs: unknown } }>().user.prefs).toEqual({ roomTourDone: false });

    const res = await call(app, jar, 'PATCH', '/api/v1/me/prefs', { roomTourDone: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ prefs: { roomTourDone: true } });

    // a second device (a fresh login) sees it
    const other = await login(app, 'alice');
    const again = await call(app, other.jar, 'GET', '/api/v1/me');
    expect(again.json<{ user: { prefs: unknown } }>().user.prefs).toEqual({ roomTourDone: true });
  });

  it('rejects unknown keys, wrong types and an empty body', async () => {
    const { jar } = await register(app);
    for (const body of [{ theme: 'light' }, { roomTourDone: 'yes' }, {}]) {
      expect((await call(app, jar, 'PATCH', '/api/v1/me/prefs', body)).statusCode).toBe(400);
    }
  });

  it('unexpected stored JSON reads as the defaults, never an error', async () => {
    const { jar, res } = await register(app);
    const id = res.json<{ user: { id: string } }>().user.id;
    await prisma.user.update({
      where: { id },
      data: { prefs: { roomTourDone: 'maybe', other: 1 } },
    });
    const me = await call(app, jar, 'GET', '/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { prefs: unknown } }>().user.prefs).toEqual({ roomTourDone: false });
    // and a patch still merges onto it
    await call(app, jar, 'PATCH', '/api/v1/me/prefs', { roomTourDone: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.prefs).toEqual({ roomTourDone: true, other: 1 });
  });
});
