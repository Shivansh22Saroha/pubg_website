import { BoardStateResponseSchema, BoardsResponseSchema } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { call, makeApp, prisma, setupRoom, useCleanState, type RoomFixture } from './harness.js';

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

const boardsOf = async (f: RoomFixture) =>
  BoardsResponseSchema.parse(
    (await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${f.roomId}/boards`)).json(),
  ).items;

describe('boards (BOARD-1/2)', () => {
  it('editor creates a board with the 3 default layers at the end of the tab order', async () => {
    const f = await setupRoom(app);
    const res = await call(app, f.editor.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Miramar – Pecado',
      mapId: 'miramar',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      board: { name: 'Miramar – Pecado', mapId: 'miramar', position: 1 },
    });
    const state = BoardStateResponseSchema.parse(
      (
        await call(
          app,
          f.viewer.jar,
          'GET',
          `/api/v1/boards/${res.json<{ board: { id: string } }>().board.id}/state`,
        )
      ).json(),
    );
    expect(state.layers.map((l) => l.name)).toEqual(['Plan', 'Enemies', 'Zones']);
    expect(state).toMatchObject({ elements: [], seq: 0 });
  });

  it('duplicates a board: same map, copied layers with new ids', async () => {
    const f = await setupRoom(app);
    await prisma.layer.updateMany({
      where: { boardId: f.boardId, name: 'Zones' },
      data: { locked: true },
    });
    const res = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Erangel – Plan 1 (copy)',
      mapId: 'rondo', // ignored: a duplicate keeps the source map
      duplicateFrom: f.boardId,
    });
    expect(res.statusCode).toBe(201);
    const copy = res.json<{ board: { id: string; mapId: string } }>().board;
    expect(copy.mapId).toBe('erangel');
    const [src, dst] = await Promise.all(
      [f.boardId, copy.id].map((id) =>
        prisma.layer.findMany({ where: { boardId: id }, orderBy: { position: 'asc' } }),
      ),
    );
    expect(dst!.map((l) => [l.name, l.color, l.locked])).toEqual(
      src!.map((l) => [l.name, l.color, l.locked]),
    );
    expect(dst!.some((l) => src!.some((s) => s.id === l.id))).toBe(false);
  });

  it('duplicateFrom must be a board of the same room (404 otherwise)', async () => {
    const f = await setupRoom(app);
    const other = await call(app, f.outsider.jar, 'POST', '/api/v1/rooms', {
      name: 'Other room',
      firstBoard: { name: 'secret', mapId: 'rondo' },
    });
    const foreign = other.json<{ board: { id: string } }>().board.id;
    const res = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'steal',
      mapId: 'rondo',
      duplicateFrom: foreign,
    });
    expect(res.statusCode).toBe(404);
  });

  it('limits a room to 20 boards (422)', async () => {
    const f = await setupRoom(app);
    for (let i = 1; i < 20; i++) {
      const r = await call(app, f.editor.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
        name: `b${i}`,
        mapId: 'rondo',
      });
      expect(r.statusCode).toBe(201);
    }
    const res = await call(app, f.editor.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'b21',
      mapId: 'rondo',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'LIMIT_REACHED' } });
  });

  it('renames and reorders (positions stay 0…n-1)', async () => {
    const f = await setupRoom(app);
    for (const name of ['B', 'C']) {
      await call(app, f.editor.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
        name,
        mapId: 'rondo',
      });
    }
    const [a, , c] = await boardsOf(f);
    expect(
      (await call(app, f.editor.jar, 'PATCH', `/api/v1/boards/${a!.id}`, { name: 'A2' }))
        .statusCode,
    ).toBe(200);
    const moved = await call(app, f.editor.jar, 'PATCH', `/api/v1/boards/${c!.id}`, {
      position: 0,
    });
    expect(moved.json()).toMatchObject({ board: { name: 'C', position: 0 } });
    expect((await boardsOf(f)).map((b) => [b.name, b.position])).toEqual([
      ['C', 0],
      ['A2', 1],
      ['B', 2],
    ]);
    expect(
      (await call(app, f.viewer.jar, 'PATCH', `/api/v1/boards/${a!.id}`, { name: 'x' })).statusCode,
    ).toBe(403);
  });

  it('delete: owner only, never the last board; positions re-sequenced', async () => {
    const f = await setupRoom(app);
    expect((await call(app, f.owner.jar, 'DELETE', `/api/v1/boards/${f.boardId}`)).statusCode).toBe(
      409,
    );
    await call(app, f.editor.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'B',
      mapId: 'rondo',
    });
    expect(
      (await call(app, f.editor.jar, 'DELETE', `/api/v1/boards/${f.boardId}`)).statusCode,
    ).toBe(403);
    expect((await call(app, f.owner.jar, 'DELETE', `/api/v1/boards/${f.boardId}`)).statusCode).toBe(
      204,
    );
    expect((await boardsOf(f)).map((b) => [b.name, b.position])).toEqual([['B', 0]]);
    expect(await prisma.layer.count({ where: { boardId: f.boardId } })).toBe(0); // cascade
  });

  it('board routes of another room are 404 for non-members (IDOR)', async () => {
    const f = await setupRoom(app);
    for (const [method, url] of [
      ['GET', `/api/v1/boards/${f.boardId}/state`],
      ['PATCH', `/api/v1/boards/${f.boardId}`],
      ['DELETE', `/api/v1/boards/${f.boardId}`],
    ] as const) {
      const res = await call(
        app,
        f.outsider.jar,
        method,
        url,
        method === 'PATCH' ? { name: 'x' } : undefined,
      );
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
