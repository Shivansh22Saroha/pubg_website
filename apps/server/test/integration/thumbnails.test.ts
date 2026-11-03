import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { purgeDeletedRooms } from '../../src/jobs/maintenance.js';
import {
  assetsDir,
  call,
  createRoom,
  CSRF,
  makeApp,
  prisma,
  setupRoom,
  thumbJpeg,
  useCleanState,
  type Jar,
} from './harness.js';

/** Phase 11 — board thumbnails (FEATURES F4, API_SPEC §8). Local storage backend. */

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp());
});

function put(jar: Jar, boardId: string, body: Buffer | string, type = 'image/jpeg') {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/boards/${boardId}/thumbnail`,
    headers: { ...CSRF, 'content-type': type },
    cookies: jar.cookies,
    payload: body,
  });
}
const fileOf = (url: string) => path.join(assetsDir, url.replace('/api/v1/assets/', ''));

describe('PUT /boards/:boardId/thumbnail', () => {
  it('stores a re-encoded JPEG under a fresh random key and shows it on the room card', async () => {
    const f = await setupRoom(app);
    const before = await prisma.board.findUniqueOrThrow({ where: { id: f.boardId } });
    // EXIF-ish metadata must not survive the re-encode
    const withMeta = await sharp(await thumbJpeg())
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-meta' } } })
      .jpeg()
      .toBuffer();
    const res = await put(f.editor.jar, f.boardId, withMeta);
    expect(res.statusCode, res.body).toBe(200);
    const { thumbnailUrl } = res.json<{ thumbnailUrl: string }>();
    expect(thumbnailUrl).toMatch(
      new RegExp(`^/api/v1/assets/thumbnails/${f.boardId}/[A-Za-z0-9_-]{22}\\.jpg$`),
    );

    const served = await app.inject({ method: 'GET', url: thumbnailUrl });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toContain('immutable');
    const meta = await sharp(served.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 256, 256]);
    expect(meta.exif).toBeUndefined();
    expect(served.rawPayload.toString('latin1')).not.toContain('secret-meta');

    // board.updatedAt (tab / "most recently edited" order) doesn't move for a picture
    const after = await prisma.board.findUniqueOrThrow({ where: { id: f.boardId } });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.thumbnailKey).toBe(thumbnailUrl.replace('/api/v1/assets/', ''));

    const rooms = await call(app, f.viewer.jar, 'GET', '/api/v1/rooms');
    expect(rooms.json<{ items: { thumbnailUrl: string | null }[] }>().items[0]?.thumbnailUrl).toBe(
      thumbnailUrl,
    );
  });

  it('a new upload replaces the key and deletes the old file', async () => {
    const f = await setupRoom(app);
    const first = (await put(f.owner.jar, f.boardId, await thumbJpeg())).json<{
      thumbnailUrl: string;
    }>().thumbnailUrl;
    const second = (await put(f.owner.jar, f.boardId, await thumbJpeg({ color: '#aa0000' }))).json<{
      thumbnailUrl: string;
    }>().thumbnailUrl;
    expect(second).not.toBe(first);
    await expect.poll(() => existsSync(fileOf(first))).toBe(false);
    expect(existsSync(fileOf(second))).toBe(true);
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(404);
  });

  it('rejects anything that is not a 256×256 JPEG ≤ 100 KB', async () => {
    const f = await setupRoom(app);
    const cases: [string, Buffer | string, string, number][] = [
      ['png bytes', await thumbJpeg({ format: 'png' }), 'image/jpeg', 400],
      ['wrong size', await thumbJpeg({ width: 300, height: 256 }), 'image/jpeg', 400],
      ['garbage after magic', Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), 'image/jpeg', 400],
      ['empty', Buffer.alloc(0), 'image/jpeg', 400],
      ['json', JSON.stringify({ a: 1 }), 'application/json', 400],
      ['other type', 'x', 'image/png', 415],
      [
        'too large',
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(101 * 1024)]),
        'image/jpeg',
        413,
      ],
    ];
    for (const [name, body, type, status] of cases) {
      const res = await put(f.owner.jar, f.boardId, body, type);
      expect(res.statusCode, `${name}: ${res.body}`).toBe(status);
    }
    expect((await prisma.board.findUniqueOrThrow({ where: { id: f.boardId } })).thumbnailKey).toBe(
      null,
    );
  });

  it('viewers 403, outsiders and unknown boards 404, CSRF enforced', async () => {
    const f = await setupRoom(app);
    const jpeg = await thumbJpeg();
    expect((await put(f.viewer.jar, f.boardId, jpeg)).statusCode).toBe(403);
    expect((await put(f.outsider.jar, f.boardId, jpeg)).statusCode).toBe(404);
    expect((await put(f.owner.jar, '0192f7a1-0000-7000-8000-00000000dead', jpeg)).statusCode).toBe(
      404,
    );
    const noCsrf = await app.inject({
      method: 'PUT',
      url: `/api/v1/boards/${f.boardId}/thumbnail`,
      headers: { 'content-type': 'image/jpeg' },
      cookies: f.owner.jar.cookies,
      payload: jpeg,
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('GET /assets only serves server-shaped keys', async () => {
    for (const url of [
      '/api/v1/assets/thumbnails/0192f7a1-0000-7000-8000-000000000001/AbCdEfGhIjKlMnOpQr_-12.jpg',
      '/api/v1/assets/thumbnails/..%2F..%2Fpackage.json/x.jpg',
      '/api/v1/assets/thumbnails/0192f7a1-0000-7000-8000-000000000001/..%2F..%2F..%2Fpackage.json',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect([400, 404], url).toContain(res.statusCode);
    }
  });

  it('deleting the board, and purging its room, delete the files', async () => {
    const f = await setupRoom(app);
    const spare = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Spare',
      mapId: 'rondo',
    });
    const spareId = spare.json<{ board: { id: string } }>().board.id;
    const a = (await put(f.owner.jar, spareId, await thumbJpeg())).json<{ thumbnailUrl: string }>();
    await call(app, f.owner.jar, 'DELETE', `/api/v1/boards/${spareId}`);
    await expect.poll(() => existsSync(fileOf(a.thumbnailUrl))).toBe(false);

    const other = await createRoom(app, f.owner.jar, { name: 'Purged room' });
    const b = (await put(f.owner.jar, other.board.id, await thumbJpeg())).json<{
      thumbnailUrl: string;
    }>();
    await prisma.room.update({
      where: { id: other.room.id },
      data: { deletedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    expect(await purgeDeletedRooms(prisma, new Date(), app.assets)).toBe(1);
    expect(existsSync(fileOf(b.thumbnailUrl))).toBe(false);
  });
});
