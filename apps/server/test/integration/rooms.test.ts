import {
  ApiErrorBodySchema,
  CreateRoomResponseSchema,
  RoomDetailResponseSchema,
  RoomListResponseSchema,
} from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import {
  call,
  createRoom,
  makeApp,
  PASSWORD,
  prisma,
  register,
  setupRoom,
  useCleanState,
} from './harness.js';

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp());
});

const code = (res: { json: () => unknown }) => ApiErrorBodySchema.parse(res.json()).error.code;
const stripReqId = (body: string) => body.replace(/"requestId":"[^"]+"/, '');

describe('create room (ROOM-1/2, FEATURES F2)', () => {
  it('creates room, OWNER membership, first board and the 3 default layers in one go', async () => {
    const { jar } = await register(app);
    const res = await call(app, jar, 'POST', '/api/v1/rooms', {
      name: '  Team Soul Scrims ',
      description: 'scrim prep',
      password: 'letmein',
      defaultRole: 'VIEWER',
      firstBoard: { name: 'Erangel – Drop A', mapId: 'erangel' },
    });
    expect(res.statusCode).toBe(201);
    const { room, board } = CreateRoomResponseSchema.parse(res.json());
    expect(room).toMatchObject({
      name: 'Team Soul Scrims',
      role: 'OWNER',
      memberCount: 1,
      boardCount: 1,
      hasPassword: true,
    });
    expect(board).toMatchObject({ name: 'Erangel – Drop A', mapId: 'erangel', position: 0 });

    const layers = await prisma.layer.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    expect(layers.map((l) => [l.name, l.color])).toEqual([
      ['Plan', '#F2A900'],
      ['Enemies', '#EF4444'],
      ['Zones', '#F8FAFC'],
    ]);
    const row = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(row.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(row.defaultRole).toBe('VIEWER');
    expect(row.maxMembers).toBe(16);
  });

  it('validates the body', async () => {
    const { jar } = await register(app);
    const bad = async (body: object) =>
      (await call(app, jar, 'POST', '/api/v1/rooms', body)).statusCode;
    const board = { name: 'x', mapId: 'erangel' };
    expect(await bad({ name: 'ab', firstBoard: board })).toBe(400);
    expect(await bad({ name: 'x'.repeat(41), firstBoard: board })).toBe(400);
    expect(await bad({ name: 'Good name', firstBoard: { name: 'x', mapId: 'sanhok' } })).toBe(400);
    expect(await bad({ name: 'Good name', firstBoard: board, defaultRole: 'OWNER' })).toBe(400);
    expect(await bad({ name: 'Good name', firstBoard: board, ownerId: 'x' })).toBe(400);
    expect(await prisma.room.count()).toBe(0);
  });

  it('caps owned rooms (MAX_OWNED_ROOMS) with 422 LIMIT_REACHED', async () => {
    const { app: small } = await makeApp({ MAX_OWNED_ROOMS: '2', RATE_LIMITS_ENABLED: 'false' });
    const { jar } = await register(small);
    await createRoom(small, jar);
    await createRoom(small, jar);
    const third = await call(small, jar, 'POST', '/api/v1/rooms', {
      name: 'Third room',
      firstBoard: { name: 'b', mapId: 'rondo' },
    });
    expect(third.statusCode).toBe(422);
    expect(code(third)).toBe('LIMIT_REACHED');
  });
});

describe('list & detail (ROOM-6, SECURITY Z2)', () => {
  it('lists only rooms the caller belongs to', async () => {
    const f = await setupRoom(app);
    await createRoom(app, f.outsider.jar, { name: 'Outsider room' });
    const list = RoomListResponseSchema.parse(
      (await call(app, f.viewer.jar, 'GET', '/api/v1/rooms')).json(),
    );
    expect(list.items.map((r) => [r.name, r.role, r.memberCount])).toEqual([
      ['Team Soul Scrims', 'VIEWER', 3],
    ]);
  });

  it('returns detail with members and boards to members, an identical 404 to everyone else', async () => {
    const f = await setupRoom(app);
    const res = await call(app, f.editor.jar, 'GET', `/api/v1/rooms/${f.roomId}`);
    expect(res.statusCode).toBe(200);
    const d = RoomDetailResponseSchema.parse(res.json());
    expect(d.room).toMatchObject({
      role: 'EDITOR',
      ownerId: f.owner.id,
      isLocked: false,
      defaultRole: 'EDITOR',
    });
    expect(d.members.map((m) => [m.user.username, m.role])).toEqual([
      ['owner', 'OWNER'],
      ['editor', 'EDITOR'],
      ['viewer', 'VIEWER'],
    ]);
    expect(d.boards).toHaveLength(1);

    const outsider = await call(app, f.outsider.jar, 'GET', `/api/v1/rooms/${f.roomId}`);
    expect(outsider.statusCode).toBe(404);
    const missing = await call(
      app,
      f.owner.jar,
      'GET',
      '/api/v1/rooms/0192f7a1-0000-7000-8000-000000000000',
    );
    expect(missing.statusCode).toBe(404);
    expect(stripReqId(outsider.body)).toBe(stripReqId(missing.body)); // no existence leak
  });
});

describe('update, password, delete (owner only)', () => {
  it('owner updates settings; editor gets 403', async () => {
    const f = await setupRoom(app);
    const url = `/api/v1/rooms/${f.roomId}`;
    expect((await call(app, f.editor.jar, 'PATCH', url, { name: 'Hijack' })).statusCode).toBe(403);
    const ok = await call(app, f.owner.jar, 'PATCH', url, {
      name: 'Renamed',
      isLocked: true,
      defaultRole: 'VIEWER',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      room: { name: 'Renamed', isLocked: true, defaultRole: 'VIEWER' },
    });
  });

  it('sets and clears the room password', async () => {
    const f = await setupRoom(app);
    const url = `/api/v1/rooms/${f.roomId}/password`;
    expect((await call(app, f.owner.jar, 'PUT', url, { password: 'secret1' })).statusCode).toBe(
      204,
    );
    expect(
      (await prisma.room.findUniqueOrThrow({ where: { id: f.roomId } })).passwordHash,
    ).not.toBeNull();
    expect((await call(app, f.owner.jar, 'PUT', url, { password: null })).statusCode).toBe(204);
    expect(
      (await prisma.room.findUniqueOrThrow({ where: { id: f.roomId } })).passwordHash,
    ).toBeNull();
    expect((await call(app, f.editor.jar, 'PUT', url, { password: 'x1234' })).statusCode).toBe(403);
  });

  it('soft-deletes only with the exact name; the room then vanishes for everyone', async () => {
    const f = await setupRoom(app);
    const url = `/api/v1/rooms/${f.roomId}`;
    const wrong = await call(app, f.owner.jar, 'DELETE', url, { confirmName: 'team soul scrims' });
    expect(wrong.statusCode).toBe(400);
    expect(
      (await call(app, f.owner.jar, 'DELETE', url, { confirmName: 'Team Soul Scrims' })).statusCode,
    ).toBe(204);
    expect(
      (await prisma.room.findUniqueOrThrow({ where: { id: f.roomId } })).deletedAt,
    ).not.toBeNull();
    for (const u of [f.owner, f.editor, f.viewer]) {
      expect((await call(app, u.jar, 'GET', url)).statusCode).toBe(404);
      expect(
        RoomListResponseSchema.parse((await call(app, u.jar, 'GET', '/api/v1/rooms')).json()).items,
      ).toEqual([]);
    }
  });
});

describe('members (ROOM-2, ROOM-5)', () => {
  it('owner changes roles; the new role applies immediately (cache busted)', async () => {
    const f = await setupRoom(app);
    const boards = `/api/v1/rooms/${f.roomId}/boards`;
    // warm the viewer's cached role
    expect(
      (await call(app, f.viewer.jar, 'POST', boards, { name: 'x', mapId: 'rondo' })).statusCode,
    ).toBe(403);
    const res = await call(
      app,
      f.owner.jar,
      'PATCH',
      `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}`,
      {
        role: 'EDITOR',
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ member: { role: 'EDITOR', user: { username: 'viewer' } } });
    expect(
      (await call(app, f.viewer.jar, 'POST', boards, { name: 'x', mapId: 'rondo' })).statusCode,
    ).toBe(201);
  });

  it("can't touch the owner's role, and only the owner manages members", async () => {
    const f = await setupRoom(app);
    const base = `/api/v1/rooms/${f.roomId}/members`;
    expect(
      (await call(app, f.owner.jar, 'PATCH', `${base}/${f.owner.id}`, { role: 'VIEWER' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(app, f.editor.jar, 'PATCH', `${base}/${f.viewer.id}`, { role: 'EDITOR' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(app, f.owner.jar, 'PATCH', `${base}/${f.outsider.id}`, { role: 'EDITOR' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, f.owner.jar, 'PATCH', `${base}/${f.viewer.id}`, { role: 'OWNER' }))
        .statusCode,
    ).toBe(400);
  });

  it('kick removes access at once and emits member:kicked', async () => {
    const f = await setupRoom(app);
    const kicked: string[] = [];
    app.roomEvents.on('member:kicked', (e) => kicked.push(e.userId));
    expect((await call(app, f.editor.jar, 'GET', `/api/v1/rooms/${f.roomId}`)).statusCode).toBe(
      200,
    );
    const res = await call(
      app,
      f.owner.jar,
      'DELETE',
      `/api/v1/rooms/${f.roomId}/members/${f.editor.id}`,
    );
    expect(res.statusCode).toBe(204);
    expect(kicked).toEqual([f.editor.id]);
    expect((await call(app, f.editor.jar, 'GET', `/api/v1/rooms/${f.roomId}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/members/${f.owner.id}`))
        .statusCode,
    ).toBe(403);
  });

  it('members can leave; the owner cannot', async () => {
    const f = await setupRoom(app);
    expect(
      (await call(app, f.viewer.jar, 'POST', `/api/v1/rooms/${f.roomId}/leave`)).statusCode,
    ).toBe(204);
    expect((await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${f.roomId}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/leave`)).statusCode,
    ).toBe(403);
  });

  it('transfers ownership with the owner password; exactly one OWNER remains', async () => {
    const f = await setupRoom(app);
    const url = `/api/v1/rooms/${f.roomId}/transfer`;
    expect(
      (await call(app, f.owner.jar, 'POST', url, { userId: f.editor.id, password: 'wrong wrong' }))
        .statusCode,
    ).toBe(401);
    expect(
      (await call(app, f.owner.jar, 'POST', url, { userId: f.outsider.id, password: PASSWORD }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, f.owner.jar, 'POST', url, { userId: f.editor.id, password: PASSWORD }))
        .statusCode,
    ).toBe(204);

    const members = await prisma.roomMember.findMany({ where: { roomId: f.roomId } });
    expect(members.filter((m) => m.role === 'OWNER').map((m) => m.userId)).toEqual([f.editor.id]);
    expect(members.find((m) => m.userId === f.owner.id)?.role).toBe('EDITOR');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: f.roomId } })).ownerId).toBe(
      f.editor.id,
    );
    // the old owner lost owner powers immediately
    expect(
      (await call(app, f.owner.jar, 'PATCH', `/api/v1/rooms/${f.roomId}`, { name: 'Nope' }))
        .statusCode,
    ).toBe(403);
  });

  it('the DB refuses a second OWNER row (partial unique index)', async () => {
    const f = await setupRoom(app);
    await expect(
      prisma.roomMember.update({
        where: { roomId_userId: { roomId: f.roomId, userId: f.editor.id } },
        data: { role: 'OWNER' },
      }),
    ).rejects.toThrow();
  });
});

describe('kick + block (room_bans)', () => {
  it('a banned user cannot rejoin through any invite (generic 403) until unbanned', async () => {
    const f = await setupRoom(app);
    const res = await call(
      app,
      f.owner.jar,
      'DELETE',
      `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}`,
      { ban: true },
    );
    expect(res.statusCode).toBe(204);
    const bans = await call(app, f.owner.jar, 'GET', `/api/v1/rooms/${f.roomId}/bans`);
    expect(bans.json()).toMatchObject({
      items: [{ user: { id: f.viewer.id }, bannedBy: { id: f.owner.id } }],
    });

    const inv = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/invites`, {
      expiresIn: '1h',
    });
    const code = inv.json<{ invite: { code: string } }>().invite.code;
    const blocked = await call(app, f.viewer.jar, 'POST', `/api/v1/invites/${code}/accept`, {});
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({
      error: { code: 'FORBIDDEN', message: "You can't join this room" },
    });

    expect(
      (await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/bans/${f.viewer.id}`))
        .statusCode,
    ).toBe(204);
    expect(
      (await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/bans/${f.viewer.id}`))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, f.viewer.jar, 'POST', `/api/v1/invites/${code}/accept`, {})).statusCode,
    ).toBe(200);
  });

  it('a plain kick (no ban) still lets the user rejoin, as FEATURES F2 allows', async () => {
    const f = await setupRoom(app);
    await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}`);
    const inv = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/invites`, {
      expiresIn: '1h',
    });
    const code = inv.json<{ invite: { code: string } }>().invite.code;
    expect(
      (await call(app, f.viewer.jar, 'POST', `/api/v1/invites/${code}/accept`, {})).statusCode,
    ).toBe(200);
  });

  it('room summaries carry the map of the most recently updated board', async () => {
    const f = await setupRoom(app);
    const list = async () =>
      (await call(app, f.owner.jar, 'GET', '/api/v1/rooms')).json<{
        items: { primaryMapId: string }[];
      }>().items[0]?.primaryMapId;
    expect(await list()).toBe('erangel');
    await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'R',
      mapId: 'rondo',
    });
    expect(await list()).toBe('rondo');
  });
});
