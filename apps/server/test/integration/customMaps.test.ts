import { existsSync } from 'node:fs';
import path from 'node:path';
import { CUSTOM_MAP_LIMITS } from '@rotationlab/shared';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { purgeDeletedRooms } from '../../src/jobs/maintenance.js';
import {
  ack,
  assetsDir,
  call,
  connect,
  listen,
  nextEvent,
  createRoom,
  newUser,
  CSRF,
  makeApp,
  mapPng,
  prisma,
  setupRoom,
  useCleanState,
  type Jar,
  type RoomFixture,
} from './harness.js';

/** Custom maps (FEATURES F20, SECURITY F20). */
useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
});

interface MapJson {
  id: string;
  roomId: string;
  name: string;
  widthM: number;
  imageUrl: string;
  previewUrl: string;
  urlsExpireAt: number;
}

function upload(
  jar: Jar,
  roomId: string,
  body: Buffer,
  query = 'name=Bermuda&widthM=2000',
  type = 'image/png',
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/custom-maps?${query}`,
    headers: { ...CSRF, 'content-type': type },
    cookies: jar.cookies,
    payload: body,
  });
}

async function uploaded(f: RoomFixture, body?: Buffer): Promise<MapJson> {
  const res = await upload(f.owner.jar, f.roomId, body ?? (await mapPng()));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ customMap: MapJson }>().customMap;
}

const fileOf = (url: string) =>
  path.join(assetsDir, new URL(url, 'http://x').pathname.replace('/api/v1/assets/', ''));

describe('custom maps', () => {
  it('stores a padded square WebP + 512 px preview, reachable only with the signed link', async () => {
    const f = await setupRoom(app);
    const map = await uploaded(f); // 400×300 landscape
    expect(map).toMatchObject({ roomId: f.roomId, name: 'Bermuda', widthM: 2000 });
    expect(map.urlsExpireAt).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1000);

    const img = await app.inject({ method: 'GET', url: map.imageUrl });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('private');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 400, 400]);
    // centred: the 50 px bands above and below are padding, the middle is the picture
    const px = async (x: number, y: number) => {
      const { data } = await sharp(img.rawPayload)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return [...data.subarray(0, 3)];
    };
    expect((await px(100, 10))[0]).toBeLessThan(40); // padding (dark)
    expect((await px(100, 200))[0]).toBeGreaterThan(200); // red half
    expect((await px(300, 200))[2]).toBeGreaterThan(200); // blue half

    const prev = await app.inject({ method: 'GET', url: map.previewUrl });
    expect((await sharp(prev.rawPayload).metadata()).width).toBe(CUSTOM_MAP_LIMITS.previewPx);

    // no signature, a tampered one, or someone else's key → 404
    const bare = map.imageUrl.split('?')[0]!;
    for (const url of [
      bare,
      `${bare}?exp=9999999999&sig=AAAA`,
      // flip the first character (a fixed 'Z' left ~1 in 64 signatures unchanged)
      map.imageUrl.replace(/sig=(.)/, (_m, c: string) => `sig=${c === 'Z' ? 'Y' : 'Z'}`),
      map.imageUrl.replace(/exp=\d+/, 'exp=1'),
    ])
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
  });

  it('refuses what is not a usable image, and bad names / widths', async () => {
    const f = await setupRoom(app);
    const png = await mapPng();
    const tiny = await mapPng(100, 80);
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
    const cases: [Buffer, string, string][] = [
      [Buffer.from('not an image'), 'name=x&widthM=2000', 'image/png'],
      [gif, 'name=x&widthM=2000', 'image/png'],
      [tiny, 'name=x&widthM=2000', 'image/png'],
      // the declared type doesn't matter: bytes are sniffed, so a PNG sent as JPEG still works
      [png, 'name=x&widthM=2000', 'image/jpeg'],
      [png, 'name=x&widthM=10', 'image/png'],
      [png, 'name=x&widthM=99999999', 'image/png'],
      [png, 'name=&widthM=2000', 'image/png'],
      [png, 'widthM=2000', 'image/png'],
    ];
    for (const [body, q, type] of cases) {
      const res = await upload(f.owner.jar, f.roomId, body, q, type);
      if (type === 'image/jpeg') expect(res.statusCode).toBe(201);
      else expect(res.statusCode, `${q} ${type}`).toBe(400);
    }
    // a type no parser takes is refused before the route; a text body never becomes an image
    for (const [type, status] of [
      ['application/pdf', 415],
      ['text/plain', 400],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/rooms/${f.roomId}/custom-maps?name=x&widthM=2000`,
        headers: { ...CSRF, 'content-type': type },
        cookies: f.owner.jar.cookies,
        payload: 'hello',
      });
      expect(res.statusCode, type).toBe(status);
    }
  });

  it(`caps a room at ${CUSTOM_MAP_LIMITS.perRoom} maps`, async () => {
    const f = await setupRoom(app);
    const png = await mapPng(300, 300);
    for (let i = 0; i < CUSTOM_MAP_LIMITS.perRoom; i += 1) await uploaded(f, png);
    const res = await upload(f.owner.jar, f.roomId, png);
    expect(res.json()).toMatchObject({ error: { code: 'LIMIT_REACHED' } });
  });

  it('boards on a custom map: created, drawn on, duplicated, shared; the map is in use', async () => {
    const f = await setupRoom(app);
    const map = await uploaded(f);
    const created = await call(app, f.editor.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Bermuda plan',
      mapId: 'custom',
      customMapId: map.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const board = created.json<{ board: { id: string; mapId: string; customMapId: string } }>()
      .board;
    expect(board).toMatchObject({ mapId: 'custom', customMapId: map.id });

    expect((await prisma.board.findUnique({ where: { id: board.id } }))?.mapId).toBe('CUSTOM');

    const dup = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
      name: 'Copy',
      mapId: 'custom',
      customMapId: map.id,
      duplicateFrom: board.id,
    });
    expect(dup.json<{ board: { customMapId: string } }>().board.customMapId).toBe(map.id);

    // a share link opens the map image too (no room id in it)
    const share = await call(app, f.owner.jar, 'POST', `/api/v1/boards/${board.id}/share`, {
      expiresIn: 'never',
    });
    const token = share.json<{ url: string }>().url.split('/s/')[1]!;
    const pub = await app.inject({ method: 'GET', url: `/api/v1/public/share/${token}` });
    const body = pub.json<{ customMap: Record<string, unknown> }>();
    expect(body.customMap).toMatchObject({ name: 'Bermuda', widthM: 2000 });
    expect(body.customMap).not.toHaveProperty('roomId');
    expect(
      (await app.inject({ method: 'GET', url: body.customMap.imageUrl as string })).statusCode,
    ).toBe(200);

    // in use → 409; after both boards go, it can be deleted and its files are removed
    const del = `/api/v1/rooms/${f.roomId}/custom-maps/${map.id}`;
    expect((await call(app, f.owner.jar, 'DELETE', del)).statusCode).toBe(409);
    await call(app, f.owner.jar, 'DELETE', `/api/v1/boards/${board.id}`);
    await call(
      app,
      f.owner.jar,
      'DELETE',
      `/api/v1/boards/${dup.json<{ board: { id: string } }>().board.id}`,
    );
    expect(existsSync(fileOf(map.imageUrl))).toBe(true);
    expect((await call(app, f.owner.jar, 'DELETE', del)).statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(fileOf(map.imageUrl))).toBe(false);
    expect(existsSync(fileOf(map.previewUrl))).toBe(false);
  });

  it("another room's custom map can't be used, renamed or deleted", async () => {
    const a = await setupRoom(app);
    const map = await uploaded(a);
    const other = await newUser(app, 'otherowner');
    const { room } = await createRoom(app, other.jar);
    const b = { roomId: room.id, owner: other };
    const res = await call(app, b.owner.jar, 'POST', `/api/v1/rooms/${b.roomId}/boards`, {
      name: 'Steal',
      mapId: 'custom',
      customMapId: map.id,
    });
    expect(res.statusCode).toBe(404);
    expect(
      (
        await call(app, b.owner.jar, 'PATCH', `/api/v1/rooms/${b.roomId}/custom-maps/${map.id}`, {
          name: 'x',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(app, b.owner.jar, 'DELETE', `/api/v1/rooms/${b.roomId}/custom-maps/${map.id}`))
        .statusCode,
    ).toBe(404);
  });

  it('rename and rescale', async () => {
    const f = await setupRoom(app);
    const map = await uploaded(f);
    const res = await call(
      app,
      f.editor.jar,
      'PATCH',
      `/api/v1/rooms/${f.roomId}/custom-maps/${map.id}`,
      {
        name: 'Bermuda v2',
        widthM: 2400,
      },
    );
    expect(res.json<{ customMap: MapJson }>().customMap).toMatchObject({
      name: 'Bermuda v2',
      widthM: 2400,
    });
    const list = await call(app, f.viewer.jar, 'GET', `/api/v1/rooms/${f.roomId}/custom-maps`);
    expect(list.json<{ items: MapJson[] }>().items.map((m) => m.widthM)).toEqual([2400]);
  });

  it('purging a deleted room removes its map files', async () => {
    const f = await setupRoom(app);
    const map = await uploaded(f);
    await prisma.room.update({
      where: { id: f.roomId },
      data: { deletedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
    });
    expect(await purgeDeletedRooms(prisma, new Date(), app.assets)).toBe(1);
    expect(existsSync(fileOf(map.imageUrl))).toBe(false);
    expect(await prisma.customMap.count({ where: { roomId: f.roomId } })).toBe(0);
  });

  it('live teammates are told to refetch when maps change (a new width changes distances)', async () => {
    const f = await setupRoom(app);
    const url = await listen(app);
    const viewer = await connect(url, f.viewer.jar);
    await ack(viewer, 'room:join', { roomId: f.roomId });
    let next = nextEvent<{ roomId: string }>(viewer, 'customMaps:changed');
    const map = await uploaded(f);
    expect(await next).toEqual({ roomId: f.roomId });
    next = nextEvent(viewer, 'customMaps:changed');
    await call(app, f.owner.jar, 'PATCH', `/api/v1/rooms/${f.roomId}/custom-maps/${map.id}`, {
      widthM: 3000,
    });
    expect(await next).toEqual({ roomId: f.roomId });
  });
});
