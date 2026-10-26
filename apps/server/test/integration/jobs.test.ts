import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import { cleanupTokens, expireInvites, purgeDeletedRooms } from '../../src/jobs/maintenance.js';
import { createRoom, invite, makeApp, prisma, register, useCleanState } from './harness.js';

/** Background jobs (ARCHITECTURE §11). */

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

const DAY = 24 * 60 * 60 * 1000;

describe('purgeDeletedRooms', () => {
  it('hard-deletes rooms soft-deleted more than 7 days ago, with everything in them', async () => {
    const { jar } = await register(app);
    const old = await createRoom(app, jar, { name: 'Old' });
    const recent = await createRoom(app, jar, { name: 'Recent' });
    const live = await createRoom(app, jar, { name: 'Live' });
    const now = new Date();
    await prisma.room.update({
      where: { id: old.room.id },
      data: { deletedAt: new Date(now.getTime() - 8 * DAY) },
    });
    await prisma.room.update({
      where: { id: recent.room.id },
      data: { deletedAt: new Date(now.getTime() - 6 * DAY) },
    });
    expect(await purgeDeletedRooms(prisma, now)).toBe(1);
    const left = (
      await prisma.room.findMany({
        where: { id: { in: [old.room.id, recent.room.id, live.room.id] } },
      })
    ).map((r) => r.name);
    expect(left.sort()).toEqual(['Live', 'Recent']);
    expect(await prisma.board.count({ where: { id: old.board.id } })).toBe(0); // cascaded
    expect(await prisma.layer.count({ where: { boardId: old.board.id } })).toBe(0);
  });
});

describe('expireInvites & cleanupTokens', () => {
  it('marks expired invites revoked; deletes long-dead tokens and old audit rows', async () => {
    const { jar, res } = await register(app);
    const userId = res.json<{ user: { id: string } }>().user.id;
    const { room } = await createRoom(app, jar);
    const inv = await invite(app, jar, room.id, { expiresIn: '1h' });
    const now = new Date(Date.now() + 2 * 60 * 60 * 1000); // two hours later
    expect(await expireInvites(prisma, now)).toBe(1);
    expect(
      (await prisma.roomInvite.findUniqueOrThrow({ where: { id: inv.id } })).revokedAt,
    ).not.toBeNull();

    // 70 days on: the 30-day refresh token expired 40 days before → past the 30-day retention
    const later = new Date(Date.now() + 70 * DAY);
    await prisma.emailToken.create({
      data: {
        id: newId(),
        userId,
        purpose: 'verify',
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: { id: newId(), action: 'test.old', createdAt: new Date(Date.now() - 100 * DAY) },
    });
    await prisma.auditLog.create({ data: { id: newId(), action: 'test.new' } });
    const out = await cleanupTokens(prisma, later);
    expect(out.refresh).toBeGreaterThan(0);
    expect(out.email).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'test.old' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'test.new' } })).toBe(1);
  });
});
