import { ApiErrorBodySchema, InvitePreviewSchema } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { generateInviteCode } from '../../src/modules/invites/service.js';
import {
  accept,
  call,
  createRoom,
  invite,
  Jar,
  makeApp,
  prisma,
  register,
  setupRoom,
  useCleanState,
} from './harness.js';

useCleanState();

let app: App;
beforeAll(async () => {
  // registrations here exceed the 5/hour register limit, which security.test.ts covers
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

const code = (res: { json: () => unknown }) => ApiErrorBodySchema.parse(res.json()).error.code;

async function user(name: string) {
  const { res, jar } = await register(app, new Jar(), {
    email: `${name}@example.com`,
    username: name,
  });
  return { id: res.json<{ user: { id: string } }>().user.id, jar };
}

describe('invite codes (SECURITY Z7)', () => {
  it('are 10 Crockford base32 chars and do not collide over 100k draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const c = generateInviteCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(100_000);
  });
});

describe('create / list / revoke (ROOM-3)', () => {
  it('creates an invite with link, expiry and max uses', async () => {
    const f = await setupRoom(app);
    const before = Date.now();
    const res = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/invites`, {
      expiresIn: '1h',
      maxUses: 3,
      role: 'VIEWER',
    });
    expect(res.statusCode).toBe(201);
    const { invite: inv } = res.json<{
      invite: { url: string; code: string; expiresAt: string; maxUses: number; role: string };
    }>();
    expect(inv.url).toBe(`http://localhost:3000/join/${inv.code}`);
    expect(inv).toMatchObject({ maxUses: 3, role: 'VIEWER', useCount: 0 });
    const ttl = new Date(inv.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(3590_000);
    expect(ttl).toBeLessThan(3610_000);
  });

  it('defaults the role to the room default; editors can invite, viewers cannot', async () => {
    const f = await setupRoom(app);
    await call(app, f.owner.jar, 'PATCH', `/api/v1/rooms/${f.roomId}`, { defaultRole: 'VIEWER' });
    expect((await invite(app, f.editor.jar, f.roomId)).url).toContain('/join/');
    const list = await call(app, f.editor.jar, 'GET', `/api/v1/rooms/${f.roomId}/invites`);
    expect(list.json<{ items: { role: string }[] }>().items.at(0)?.role).toBe('VIEWER');
    const viewer = await call(app, f.viewer.jar, 'POST', `/api/v1/rooms/${f.roomId}/invites`, {
      expiresIn: '24h',
    });
    expect(viewer.statusCode).toBe(403);
  });

  it('revoke: owner or creator only; revoked invites disappear from the list and stop working', async () => {
    const f = await setupRoom(app);
    const mine = await invite(app, f.editor.jar, f.roomId);
    const owners = await invite(app, f.owner.jar, f.roomId);
    const del = (jar: Jar, id: string) =>
      call(app, jar, 'DELETE', `/api/v1/rooms/${f.roomId}/invites/${id}`);
    expect((await del(f.editor.jar, owners.id)).statusCode).toBe(403);
    expect((await del(f.editor.jar, mine.id)).statusCode).toBe(204);
    expect((await del(f.owner.jar, owners.id)).statusCode).toBe(204);
    expect((await del(f.outsider.jar, owners.id)).statusCode).toBe(404);
    const list = await call(app, f.owner.jar, 'GET', `/api/v1/rooms/${f.roomId}/invites`);
    expect(list.json<{ items: unknown[] }>().items.length).toBe(2); // the fixture's two
    const res = await accept(app, f.outsider.jar, mine.code);
    expect(res.statusCode).toBe(410);
  });
});

describe('preview (GET /invites/:code)', () => {
  it('is public and shows room info; unknown codes 404', async () => {
    const f = await setupRoom(app);
    await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Pecado',
      mapId: 'miramar',
    });
    const inv = await invite(app, f.owner.jar, f.roomId);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/invites/${inv.code.toLowerCase().slice(0, 4)}-${inv.code.slice(4).toLowerCase()}`,
    });
    expect(res.statusCode).toBe(200);
    expect(InvitePreviewSchema.parse(res.json())).toEqual({
      room: {
        name: 'Team Soul Scrims',
        memberCount: 3,
        ownerName: 'owner',
        hasPassword: false,
        maps: ['erangel', 'miramar'],
      },
      valid: true,
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/invites/0000000000' })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/invites/not-a-code!' })).statusCode,
    ).toBe(400);
  });
});

describe('accept (ROOM-4)', () => {
  it('joins with the invite role and increments the use count', async () => {
    const f = await setupRoom(app);
    const inv = await invite(app, f.owner.jar, f.roomId, { role: 'VIEWER' });
    const res = await accept(app, f.outsider.jar, inv.code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ roomId: f.roomId });
    const m = await prisma.roomMember.findUniqueOrThrow({
      where: { roomId_userId: { roomId: f.roomId, userId: f.outsider.id } },
    });
    expect(m.role).toBe('VIEWER');
    expect((await prisma.roomInvite.findUniqueOrThrow({ where: { id: inv.id } })).useCount).toBe(1);
  });

  it('already a member → 409 ALREADY_MEMBER carrying the roomId', async () => {
    const f = await setupRoom(app);
    const inv = await invite(app, f.owner.jar, f.roomId);
    const res = await accept(app, f.editor.jar, inv.code);
    expect(res.statusCode).toBe(409);
    expect(ApiErrorBodySchema.parse(res.json()).error).toMatchObject({
      code: 'ALREADY_MEMBER',
      details: [{ path: 'roomId', issue: f.roomId }],
    });
  });

  it('expired → 410 INVITE_EXPIRED', async () => {
    const f = await setupRoom(app);
    const inv = await invite(app, f.owner.jar, f.roomId, { expiresIn: '1h' });
    await prisma.roomInvite.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await accept(app, f.outsider.jar, inv.code);
    expect(res.statusCode).toBe(410);
    expect(code(res)).toBe('INVITE_EXPIRED');
    const preview = await app.inject({ method: 'GET', url: `/api/v1/invites/${inv.code}` });
    expect(preview.json()).toMatchObject({ valid: false });
  });

  it('enforces max uses under CONCURRENT accepts: 10 in parallel, max 3 → exactly 3 succeed', async () => {
    const { jar: ownerJar } = await register(app, new Jar(), {
      email: 'boss@example.com',
      username: 'boss',
    });
    const { room } = await createRoom(app, ownerJar);
    const inv = await invite(app, ownerJar, room.id, { maxUses: 3 });
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => user(`racer_${i}`)));
    const results = await Promise.all(users.map((u) => accept(app, u.jar, inv.code)));
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 410)).toHaveLength(7);
    expect(await prisma.roomMember.count({ where: { roomId: room.id } })).toBe(4);
    expect((await prisma.roomInvite.findUniqueOrThrow({ where: { id: inv.id } })).useCount).toBe(3);
  });

  it('room full → 422 LIMIT_REACHED (also under concurrency)', async () => {
    const { jar: ownerJar } = await register(app, new Jar(), {
      email: 'boss@example.com',
      username: 'boss',
    });
    const { room } = await createRoom(app, ownerJar);
    await prisma.room.update({ where: { id: room.id }, data: { maxMembers: 3 } });
    const inv = await invite(app, ownerJar, room.id);
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => user(`join_${i}`)));
    const results = await Promise.all(users.map((u) => accept(app, u.jar, inv.code)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(2);
    expect(
      results.filter((r) => r.statusCode === 422).every((r) => code(r) === 'LIMIT_REACHED'),
    ).toBe(true);
    expect(await prisma.roomMember.count({ where: { roomId: room.id } })).toBe(3);
  });

  it('password-protected room: missing/wrong password → 403 WRONG_ROOM_PASSWORD, 5 tries per 10 min', async () => {
    const { app: limited } = await makeApp(); // rate limits on
    const f = await setupRoom(limited);
    await call(limited, f.owner.jar, 'PUT', `/api/v1/rooms/${f.roomId}/password`, {
      password: 'scrims2026',
    });
    const inv = await invite(limited, f.owner.jar, f.roomId);
    expect(code(await accept(limited, f.outsider.jar, inv.code))).toBe('WRONG_ROOM_PASSWORD');
    for (let i = 0; i < 4; i++) {
      expect(
        code(await accept(limited, f.outsider.jar, inv.code, { password: `wrong-${i}` })),
      ).toBe('WRONG_ROOM_PASSWORD');
    }
    const blocked = await accept(limited, f.outsider.jar, inv.code, { password: 'scrims2026' });
    expect(blocked.statusCode).toBe(429);
  });

  it('password-protected room: correct password joins', async () => {
    const f = await setupRoom(app);
    await call(app, f.owner.jar, 'PUT', `/api/v1/rooms/${f.roomId}/password`, {
      password: 'scrims2026',
    });
    const inv = await invite(app, f.owner.jar, f.roomId);
    expect(
      (await accept(app, f.outsider.jar, inv.code, { password: 'scrims2026' })).statusCode,
    ).toBe(200);
  });

  it('locked room → 403 ROOM_LOCKED', async () => {
    const f = await setupRoom(app);
    const inv = await invite(app, f.owner.jar, f.roomId);
    await call(app, f.owner.jar, 'PATCH', `/api/v1/rooms/${f.roomId}`, { isLocked: true });
    const res = await accept(app, f.outsider.jar, inv.code);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('ROOM_LOCKED');
  });

  it("caps an invite at its creator's current role (editor later downgraded → viewer)", async () => {
    const f = await setupRoom(app);
    const inv = await invite(app, f.editor.jar, f.roomId, { role: 'EDITOR' });
    await call(app, f.owner.jar, 'PATCH', `/api/v1/rooms/${f.roomId}/members/${f.editor.id}`, {
      role: 'VIEWER',
    });
    expect((await accept(app, f.outsider.jar, inv.code)).statusCode).toBe(200);
    const m = await prisma.roomMember.findUniqueOrThrow({
      where: { roomId_userId: { roomId: f.roomId, userId: f.outsider.id } },
    });
    expect(m.role).toBe('VIEWER');
  });

  it('deleted room → 404', async () => {
    const f = await setupRoom(app);
    const inv = await invite(app, f.owner.jar, f.roomId);
    await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}`, {
      confirmName: 'Team Soul Scrims',
    });
    expect((await accept(app, f.outsider.jar, inv.code)).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/invites/${inv.code}` })).statusCode,
    ).toBe(404);
  });
});
