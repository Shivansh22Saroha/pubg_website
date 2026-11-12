import { AdminStatsResponseSchema, UserResponseSchema } from '@rotationlab/shared';
import { describe, expect, it } from 'vitest';
import { call, Jar, makeApp, register, useCleanState } from './harness.js';

/** FEATURES F16: the site admin dashboard's data, for ADMIN_EMAILS only. */
describe('GET /api/v1/admin/stats', () => {
  useCleanState();

  it('admins get site-wide numbers; everyone else gets 404 (anonymous 401)', async () => {
    const { app } = await makeApp({ ADMIN_EMAILS: ' Boss@Example.com , other@example.com' });
    const { jar: boss } = await register(app, new Jar(), {
      email: 'boss@example.com',
      username: 'boss',
    });
    const { jar: player } = await register(app, new Jar(), {
      email: 'player@example.com',
      username: 'player',
    });
    await call(app, player, 'POST', '/api/v1/rooms', {
      name: 'Squad Alpha',
      firstBoard: { name: 'Drop A', mapId: 'miramar' },
    });

    const res = await call(app, boss, 'GET', '/api/v1/admin/stats');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { stats } = AdminStatsResponseSchema.parse(res.json());
    expect(stats.totals).toMatchObject({ users: 2, rooms: 1, boards: 1 });
    expect(stats.active.last24h).toBe(2); // both registered (a session each)
    expect(stats.signupsByDay).toHaveLength(30);
    expect(stats.signupsByDay.at(-1)?.count).toBe(2);
    expect(stats.boardsByMap).toEqual([{ mapId: 'miramar', boards: 1 }]);
    expect(stats.topRooms[0]).toMatchObject({ name: 'Squad Alpha', members: 1, boards: 1 });
    const p = stats.recentUsers.find((u) => u.username === 'player');
    expect(p).toMatchObject({ emailMasked: 'pl••••@example.com', rooms: 1 });
    // nothing secret leaves: no raw emails, ids or hashes
    expect(JSON.stringify(stats)).not.toMatch(/player@example\.com|password|hash/i);

    expect((await call(app, player, 'GET', '/api/v1/admin/stats')).statusCode).toBe(404);
    expect((await call(app, new Jar(), 'GET', '/api/v1/admin/stats')).statusCode).toBe(401);

    const meBoss = UserResponseSchema.parse((await call(app, boss, 'GET', '/api/v1/me')).json());
    const mePlayer = UserResponseSchema.parse(
      (await call(app, player, 'GET', '/api/v1/me')).json(),
    );
    expect(meBoss.user.isAdmin).toBe(true);
    expect(mePlayer.user.isAdmin).toBe(false);
  });

  it('with no ADMIN_EMAILS nobody is an admin', async () => {
    const { app } = await makeApp();
    const { jar } = await register(app);
    expect((await call(app, jar, 'GET', '/api/v1/admin/stats')).statusCode).toBe(404);
  });
});
