import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { expireShareLinks } from '../../src/jobs/maintenance.js';
import { newId } from '../../src/lib/ids.js';
import { call, makeApp, prisma, setupRoom, useCleanState, type RoomFixture } from './harness.js';

/** Phase 11 — public read-only share links (FEATURES F4b, API_SPEC §5b, SECURITY Z8). */

useCleanState();

let app: App;
let logs: string[];
beforeAll(async () => {
  const made = await makeApp();
  app = made.app;
  logs = made.logs.lines;
});

const tokenOf = (url: string) => url.split('/s/')[1] ?? '';
const read = (token: string) => app.inject({ method: 'GET', url: `/api/v1/public/share/${token}` });

async function share(f: RoomFixture, expiresIn = 'never', who: 'owner' | 'editor' = 'owner') {
  const res = await call(app, f[who].jar, 'POST', `/api/v1/boards/${f.boardId}/share`, {
    expiresIn,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res;
}

async function addMarker(f: RoomFixture, label: string) {
  const layer = await prisma.layer.findFirstOrThrow({ where: { boardId: f.boardId } });
  await prisma.element.create({
    data: {
      id: newId(),
      boardId: f.boardId,
      layerId: layer.id,
      type: 'MARKER',
      geometry: { at: [400_000, 400_000] },
      style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 },
      props: { kind: 'enemy_squad', number: 1, label },
      seq: 1n,
      createdBy: f.editor.id,
      updatedBy: f.editor.id,
    },
  });
}

describe('managing a share link', () => {
  it('create → the URL once, a 128-bit token, only its SHA-256 stored, audit row', async () => {
    const f = await setupRoom(app);
    const res = await share(f, '7d');
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<{ url: string; share: { expiresAt: string; createdAt: string } }>();
    const token = tokenOf(body.url);
    expect(body.url).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
    const expires = Date.parse(body.share.expiresAt) - Date.now();
    expect(expires).toBeGreaterThan(7 * 86_400_000 - 60_000);
    expect(expires).toBeLessThanOrEqual(7 * 86_400_000);

    const row = await prisma.shareLink.findUniqueOrThrow({ where: { boardId: f.boardId } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    // the status never returns the token
    const status = await call(app, f.editor.jar, 'GET', `/api/v1/boards/${f.boardId}/share`);
    expect(status.json()).toEqual({ share: body.share });
    expect(status.body).not.toContain(token);
    const audit = await prisma.auditLog.findMany({ where: { targetId: f.boardId } });
    expect(audit.map((a) => a.action)).toEqual(['share.create']);
    // the token never reaches the logs either
    expect(logs.join('\n')).not.toContain(token);
  });

  it('a board without a link reports null', async () => {
    const f = await setupRoom(app);
    const res = await call(app, f.viewer.jar, 'GET', `/api/v1/boards/${f.boardId}/share`);
    expect(res.statusCode).toBe(403); // viewers can't manage links
    const own = await call(app, f.owner.jar, 'GET', `/api/v1/boards/${f.boardId}/share`);
    expect(own.json()).toEqual({ share: null });
  });

  it('regenerate replaces the token: the old one stops working at once', async () => {
    const f = await setupRoom(app);
    const first = tokenOf((await share(f)).json<{ url: string }>().url);
    const second = tokenOf((await share(f, '24h', 'editor')).json<{ url: string }>().url);
    expect(second).not.toBe(first);
    expect((await read(first)).statusCode).toBe(404);
    expect((await read(second)).statusCode).toBe(200);
    expect(await prisma.shareLink.count()).toBe(1);
    const audit = await prisma.auditLog.findMany({
      where: { targetId: f.boardId },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['share.create', 'share.regenerate']);
  });

  it('revoke → 404 for the token; revoking again is a 204 no-op', async () => {
    const f = await setupRoom(app);
    const token = tokenOf((await share(f)).json<{ url: string }>().url);
    const del = await call(app, f.editor.jar, 'DELETE', `/api/v1/boards/${f.boardId}/share`);
    expect(del.statusCode).toBe(204);
    expect((await read(token)).statusCode).toBe(404);
    const again = await call(app, f.owner.jar, 'DELETE', `/api/v1/boards/${f.boardId}/share`);
    expect(again.statusCode).toBe(204);
    expect(
      await prisma.auditLog.count({ where: { targetId: f.boardId, action: 'share.revoke' } }),
    ).toBe(1);
  });

  it('non-members get 404 on every management route, and on unknown boards', async () => {
    const f = await setupRoom(app);
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const res = await call(app, f.outsider.jar, method, `/api/v1/boards/${f.boardId}/share`, {
        expiresIn: 'never',
      });
      expect(res.statusCode, method).toBe(404);
    }
    const unknown = await call(app, f.owner.jar, 'GET', `/api/v1/boards/${newId()}/share`);
    expect(unknown.statusCode).toBe(404);
  });

  it('rejects unknown expiries and extra keys', async () => {
    const f = await setupRoom(app);
    for (const payload of [{ expiresIn: '1y' }, { expiresIn: '7d', boardId: f.boardId }, {}]) {
      const res = await call(
        app,
        f.owner.jar,
        'POST',
        `/api/v1/boards/${f.boardId}/share`,
        payload,
      );
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe('GET /public/share/:token', () => {
  it('serves the current state without room id, user ids or member names', async () => {
    const f = await setupRoom(app);
    const token = tokenOf((await share(f)).json<{ url: string }>().url);
    await addMarker(f, 'Bridge team');
    const res = await read(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const body = res.json<{
      board: Record<string, unknown>;
      layers: unknown[];
      elements: Record<string, unknown>[];
      expiresAt: null;
    }>();
    expect(body.board.id).toBe(f.boardId);
    expect(body.board).not.toHaveProperty('roomId');
    expect(body.layers).toHaveLength(3);
    expect(body.elements).toHaveLength(1);
    expect(body.elements[0]).toMatchObject({ createdBy: null, updatedBy: null });
    expect(body.expiresAt).toBeNull();
    for (const secret of [
      f.roomId,
      f.owner.id,
      f.editor.id,
      f.viewer.id,
      'owner',
      'editor',
      'Team Soul Scrims',
    ])
      expect(res.body, secret).not.toContain(secret);
    // the token in the path never reaches the request logs
    expect(logs.join('\n')).not.toContain(token);
    expect(logs.join('\n')).toContain('/public/share/[redacted]');
    // current state, not a copy taken at share time
    await addMarker(f, 'Second team');
    expect((await read(token)).json<{ elements: unknown[] }>().elements).toHaveLength(2);
  });

  it('expired, malformed, unknown and deleted-room tokens all answer the same 404', async () => {
    const f = await setupRoom(app);
    const token = tokenOf((await share(f, '24h')).json<{ url: string }>().url);
    await prisma.shareLink.update({
      where: { boardId: f.boardId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await read(token);
    const unknown = await read('A'.repeat(22));
    expect(expired.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(expired.json<{ error: { message: string } }>().error.message).toBe(
      unknown.json<{ error: { message: string } }>().error.message,
    );
    expect((await read('not-a-token')).statusCode).toBe(400);

    const live = tokenOf((await share(f)).json<{ url: string }>().url);
    expect((await read(live)).statusCode).toBe(200);
    await prisma.room.update({ where: { id: f.roomId }, data: { deletedAt: new Date() } });
    expect((await read(live)).statusCode).toBe(404);
  });

  it('the expiry job deletes expired links only', async () => {
    const f = await setupRoom(app);
    await share(f, '24h');
    const now = new Date(Date.now() + 2 * 86_400_000);
    expect(await expireShareLinks(prisma, now)).toBe(1);
    expect(await prisma.shareLink.count()).toBe(0);
  });

  it('is rate-limited per IP (30 / min)', async () => {
    const { app: limited } = await makeApp({ RATE_LIMITS_ENABLED: 'true' });
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await limited.inject({
        method: 'GET',
        url: `/api/v1/public/share/${'B'.repeat(22)}`,
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 30).every((c) => c === 404)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});
