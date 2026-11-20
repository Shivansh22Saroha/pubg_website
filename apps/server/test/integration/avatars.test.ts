import { existsSync } from 'node:fs';
import path from 'node:path';
import { AVATAR_LIMITS } from '@rotationlab/shared';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import {
  assetsDir,
  call,
  CSRF,
  makeApp,
  mapPng,
  newUser,
  PASSWORD,
  prisma,
  setupRoom,
  useCleanState,
  type Jar,
} from './harness.js';

/** Profile photos (FEATURES F23, SECURITY F23). */
useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

interface UserJson {
  id: string;
  avatarUrl: string | null;
  avatarColor: string;
}

function put(jar: Jar, body: Buffer, type = 'image/png') {
  return app.inject({
    method: 'PUT',
    url: '/api/v1/me/avatar',
    headers: { ...CSRF, 'content-type': type },
    cookies: jar.cookies,
    payload: body,
  });
}

async function setPhoto(jar: Jar, body?: Buffer): Promise<UserJson> {
  const res = await put(jar, body ?? (await mapPng(400, 300)));
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ user: UserJson }>().user;
}

const fileOf = (url: string) =>
  path.join(assetsDir, new URL(url, 'http://x').pathname.replace('/api/v1/assets/', ''));

describe('profile photos', () => {
  it('stores a 256 px square WebP without metadata, reachable only with the signed link', async () => {
    const u = await newUser(app, 'scout');
    const me = await setPhoto(u.jar);
    expect(me.avatarUrl).toMatch(
      new RegExp(`^/api/v1/assets/avatars/${me.id}/[A-Za-z0-9_-]{22}\\.webp\\?exp=\\d+&sig=`),
    );
    const img = await app.inject({ method: 'GET', url: me.avatarUrl! });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('private');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual([
      'webp',
      AVATAR_LIMITS.sizePx,
      AVATAR_LIMITS.sizePx,
    ]);
    expect(meta.exif).toBeUndefined();

    // GET /me carries it too
    const again = await call(app, u.jar, 'GET', '/api/v1/me');
    expect(again.json<{ user: UserJson }>().user.avatarUrl).toBe(me.avatarUrl);

    const bare = me.avatarUrl!.split('?')[0]!;
    for (const url of [
      bare,
      `${bare}?exp=9999999999&sig=AAAA`,
      me.avatarUrl!.replace(/sig=[^&]+/, 'sig=x'),
      me.avatarUrl!.replace(/exp=\d+/, 'exp=1'),
      me.avatarUrl!.replace(me.id, '0192f7a1-0000-7000-8000-000000000009'),
    ])
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
  });

  it('replacing the photo gives a new URL and deletes the old file; remove goes back to initials', async () => {
    const u = await newUser(app, 'scout');
    const first = await setPhoto(u.jar);
    const second = await setPhoto(u.jar, await mapPng(300, 500));
    expect(second.avatarUrl).not.toBe(first.avatarUrl);
    await expect.poll(() => existsSync(fileOf(first.avatarUrl!))).toBe(false);
    expect(existsSync(fileOf(second.avatarUrl!))).toBe(true);

    const removed = await call(app, u.jar, 'DELETE', '/api/v1/me/avatar');
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ user: UserJson }>().user.avatarUrl).toBeNull();
    await expect.poll(() => existsSync(fileOf(second.avatarUrl!))).toBe(false);
    // removing twice is fine
    expect((await call(app, u.jar, 'DELETE', '/api/v1/me/avatar')).statusCode).toBe(200);
  });

  it('refuses what is not a usable image', async () => {
    const u = await newUser(app, 'scout');
    const tiny = await mapPng(40, 40);
    const png = await mapPng();
    const cases: [Buffer, string, number][] = [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png', 400],
      [Buffer.from('GIF89a........'), 'image/png', 400],
      [png, 'image/svg+xml', 415],
      [png, 'image/gif', 415],
      [tiny, 'image/png', 400],
      [Buffer.alloc(0), 'image/png', 400],
      [Buffer.alloc(AVATAR_LIMITS.uploadMaxBytes + 1, 1), 'image/png', 413],
      [await sharp(png).jpeg().toBuffer(), 'image/png', 200], // the bytes decide, not the header
    ];
    for (const [body, type, status] of cases) {
      const res = await put(u.jar, body, type);
      expect(res.statusCode, `${type} ${body.length}: ${res.body}`).toBe(status);
    }
  });

  it('teammates see the photo on the member list', async () => {
    const f = await setupRoom(app);
    const me = await setPhoto(f.editor.jar);
    const room = await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${f.roomId}`);
    const members = room.json<{ members: { user: UserJson }[] }>().members;
    const editor = members.find((m) => m.user.id === f.editor.id)!;
    expect(editor.user.avatarUrl?.split('?')[0]).toBe(me.avatarUrl?.split('?')[0]);
    expect(members.find((m) => m.user.id === f.owner.id)!.user.avatarUrl).toBeNull();
    const img = await app.inject({ method: 'GET', url: editor.user.avatarUrl! });
    expect(img.statusCode).toBe(200);
  });

  it('deleting the account deletes the photo', async () => {
    const u = await newUser(app, 'scout');
    const me = await setPhoto(u.jar);
    const res = await call(app, u.jar, 'DELETE', '/api/v1/me', {
      password: PASSWORD,
      confirm: 'DELETE',
      rooms: [],
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).avatarKey).toBeNull();
    await expect.poll(() => existsSync(fileOf(me.avatarUrl!))).toBe(false);
  });
});
