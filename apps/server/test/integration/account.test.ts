import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import {
  accept,
  call,
  createRoom,
  invite,
  Jar,
  login,
  makeApp,
  PASSWORD,
  prisma,
  register,
  setupRoom,
  useCleanState,
} from './harness.js';

/** Delete account (AUTH-8, DATABASE_SCHEMA §6, UF-14). */

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

const del = (jar: Jar, body: object) =>
  call(app, jar, 'DELETE', '/api/v1/me', { password: PASSWORD, confirm: 'DELETE', ...body });

describe('DELETE /me', () => {
  it('owned rooms: explicit transfer, explicit delete, and the fallback to the longest-standing editor', async () => {
    const f = await setupRoom(app); // owner + editor + viewer
    const roomTransfer = f.roomId; // → the viewer, explicitly
    const roomDelete = (await createRoom(app, f.owner.jar, { name: 'Scratch' })).room.id;
    const roomFallback = (await createRoom(app, f.owner.jar, { name: 'Scrims' })).room.id;
    // fallback room: a viewer joined first, then two editors; the earlier editor wins
    for (const [jar, role] of [
      [f.viewer.jar, 'VIEWER'],
      [f.editor.jar, 'EDITOR'],
      [f.outsider.jar, 'EDITOR'],
    ] as const) {
      const inv = await invite(app, f.owner.jar, roomFallback, { role });
      expect((await accept(app, jar, inv.code)).statusCode).toBe(200);
    }
    await prisma.chatMessage.create({
      data: {
        id: newId(),
        roomId: roomTransfer,
        authorId: f.owner.id,
        body: 'gg',
        clientId: randomUUID(),
      },
    });
    const sessions = await prisma.refreshToken.count({
      where: { userId: f.owner.id, revokedAt: null },
    });
    expect(sessions).toBeGreaterThan(0);

    const res = await del(f.owner.jar, {
      rooms: [
        { roomId: roomTransfer, action: 'transfer', toUserId: f.viewer.id },
        { roomId: roomDelete, action: 'delete' },
      ],
    });
    expect(res.statusCode, res.body).toBe(204);

    const rooms = await prisma.room.findMany({
      where: { id: { in: [roomTransfer, roomDelete, roomFallback] } },
      include: { members: true },
    });
    const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
    expect(byId[roomTransfer]).toMatchObject({ ownerId: f.viewer.id, deletedAt: null });
    expect(byId[roomTransfer]!.members.find((m) => m.userId === f.viewer.id)?.role).toBe('OWNER');
    expect(byId[roomDelete]!.deletedAt).not.toBeNull();
    expect(byId[roomFallback]).toMatchObject({ ownerId: f.editor.id, deletedAt: null });
    for (const r of rooms) expect(r.members.some((m) => m.userId === f.owner.id)).toBe(false);

    // anonymised, chat kept without an author, every token revoked, audited
    const me = await prisma.user.findUniqueOrThrow({ where: { id: f.owner.id } });
    expect(me.email).toBe(`deleted+${f.owner.id}@invalid`);
    expect(me.username).toMatch(/^deleted_[0-9a-f]{12}$/);
    expect(me).toMatchObject({ displayName: 'Deleted user', ign: null });
    expect(me.deletedAt).not.toBeNull();
    const chat = await prisma.chatMessage.findMany({
      where: { roomId: roomTransfer, kind: 'USER' },
    });
    expect(chat.map((m) => [m.body, m.authorId])).toEqual([['gg', null]]);
    expect(
      await prisma.refreshToken.count({ where: { userId: f.owner.id, revokedAt: null } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { actorId: f.owner.id, action: 'account.delete' } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { actorId: f.owner.id, action: 'room.transfer' } }),
    ).toBe(2);

    // logged out everywhere; can't log back in (old email or username)
    expect((await call(app, f.owner.jar, 'GET', '/api/v1/me')).statusCode).toBe(401);
    expect((await call(app, f.owner.jar, 'POST', '/api/v1/auth/refresh')).statusCode).toBe(401);
    expect((await login(app, 'owner')).res.statusCode).toBe(401);
    expect((await login(app, 'owner@example.com')).res.statusCode).toBe(401);
    // the new owner sees themselves as owner
    const detail = await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${roomTransfer}`);
    expect(detail.json<{ room: { role: string } }>().room.role).toBe('OWNER');
    // the email and username are free again
    expect(
      (await register(app, new Jar(), { email: 'owner@example.com', username: 'owner' })).res
        .statusCode,
    ).toBe(201);
  });

  it('no editor and no choice → the room is soft-deleted', async () => {
    const { jar } = await register(app);
    const { room } = await createRoom(app, jar);
    const viewer = await register(app, new Jar(), { email: 'v@example.com', username: 'vee' });
    await accept(app, viewer.jar, (await invite(app, jar, room.id, { role: 'VIEWER' })).code);
    expect((await del(jar, {})).statusCode).toBe(204);
    expect(
      (await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).deletedAt,
    ).not.toBeNull();
  });

  it('refuses a wrong password, a missing DELETE, a non-member transfer or someone else’s room — and changes nothing', async () => {
    const f = await setupRoom(app);
    const other = await createRoom(app, f.editor.jar, { name: 'Not yours' });
    expect((await del(f.owner.jar, { password: 'wrong password!!' })).statusCode).toBe(401);
    expect(
      (await call(app, f.owner.jar, 'DELETE', '/api/v1/me', { password: PASSWORD })).statusCode,
    ).toBe(400);
    expect(
      (
        await del(f.owner.jar, {
          rooms: [{ roomId: f.roomId, action: 'transfer', toUserId: f.outsider.id }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await del(f.owner.jar, { rooms: [{ roomId: other.room.id, action: 'delete' }] })).statusCode,
    ).toBe(400);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.id } })).deletedAt,
    ).toBeNull();
    expect((await prisma.room.findUniqueOrThrow({ where: { id: f.roomId } })).ownerId).toBe(
      f.owner.id,
    );
    expect((await call(app, f.owner.jar, 'GET', '/api/v1/me')).statusCode).toBe(200);
  });
});
