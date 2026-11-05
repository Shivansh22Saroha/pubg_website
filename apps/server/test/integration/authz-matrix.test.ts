import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { newId } from '../../src/lib/ids.js';
import { createMemoryMailer } from '../../src/lib/mailer.js';
import {
  accept,
  call,
  CSRF,
  invite,
  Jar,
  register,
  makeApp,
  PASSWORD,
  prisma,
  setupRoom,
  thumbJpeg,
  useCleanState,
  type RoomFixture,
} from './harness.js';

/**
 * Authz matrix (SECURITY §3, TESTING §5.1): every registered route × every caller.
 * The suite FAILS if a route exists without a row, so nothing ships unchecked. Each cell runs
 * against a fresh room (owner + editor + viewer, plus an outsider who is logged in but not a
 * member). Non-members always get 404 for room-scoped routes, never 403 (Z2).
 */
const CALLERS = ['anonymous', 'outsider', 'viewer', 'editor', 'owner'] as const;
type Caller = (typeof CALLERS)[number];
type Expect = Record<Caller, number>;

interface Ctx {
  f: RoomFixture;
  /** a second board, so the owner's delete isn't the last-board 409 */
  spareBoardId: string;
  inviteCode: string;
  inviteId: string;
  /** a former member the owner kicked with `ban: true` */
  bannedId: string;
  /** a chat message written by the editor (delete: author or owner) */
  messageId: string;
  /** a snapshot saved by the editor (delete: author or owner) */
  snapshotId: string;
  /** the board's public share token (Phase 11) */
  shareToken: string;
  /** a 256×256 JPEG, and the URL of the board's stored thumbnail (Phase 11) */
  jpeg: Buffer;
  thumbnailUrl: string;
}

interface Row {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  request: (ctx: Ctx) => { url: string; payload?: object; headers?: Record<string, string> };
  expect: Expect;
}

const UUID = '0192f7a1-0000-7000-8000-000000000000';
/** 401 for anonymous, `status` for every logged-in caller */
const authed = (status: number): Expect => ({
  anonymous: 401,
  outsider: status,
  viewer: status,
  editor: status,
  owner: status,
});
const everyone = (status: number): Expect => ({
  anonymous: status,
  outsider: status,
  viewer: status,
  editor: status,
  owner: status,
});
/** room-scoped: 401 anonymous, 404 outsider, then per role */
const room = (viewer: number, editor: number, owner: number): Expect => ({
  anonymous: 401,
  outsider: 404,
  viewer,
  editor,
  owner,
});

const MATRIX: Row[] = [
  // ---- meta & auth (Phase 3) -------------------------------------------------------
  {
    method: 'GET',
    url: '/api/health',
    request: () => ({ url: '/api/health' }),
    expect: everyone(200),
  },
  // Phase 10: Prometheus; never routed by Caddy, token-guarded only when METRICS_TOKEN is set
  {
    method: 'GET',
    url: '/metrics',
    request: () => ({ url: '/metrics' }),
    expect: everyone(200),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/register',
    request: () => ({
      url: '/api/v1/auth/register',
      payload: {
        email: 'new@example.com',
        username: 'newbie',
        password: 'correct horse battery staple',
      },
    }),
    expect: everyone(201), // a second account while logged in is allowed
  },
  {
    method: 'POST',
    url: '/api/v1/auth/login',
    request: () => ({
      url: '/api/v1/auth/login',
      payload: { identifier: 'owner', password: 'wrong wrong wrong' },
    }),
    expect: everyone(401),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/refresh',
    request: () => ({ url: '/api/v1/auth/refresh' }),
    expect: authed(204),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/logout',
    request: () => ({ url: '/api/v1/auth/logout' }),
    expect: everyone(204),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/logout-all',
    request: () => ({ url: '/api/v1/auth/logout-all' }),
    expect: authed(204),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/socket-ticket',
    request: () => ({ url: '/api/v1/auth/socket-ticket' }),
    expect: authed(200),
  },
  {
    method: 'GET',
    url: '/api/v1/auth/username-available',
    request: () => ({ url: '/api/v1/auth/username-available?u=zed' }),
    expect: everyone(200),
  },
  { method: 'GET', url: '/api/v1/me', request: () => ({ url: '/api/v1/me' }), expect: authed(200) },
  {
    method: 'PATCH',
    url: '/api/v1/me',
    request: () => ({ url: '/api/v1/me', payload: { ign: 'Scout' } }),
    expect: authed(200),
  },
  {
    method: 'PATCH',
    url: '/api/v1/me/prefs',
    request: () => ({ url: '/api/v1/me/prefs', payload: { roomTourDone: true } }),
    expect: authed(200),
  },
  {
    method: 'POST',
    url: '/api/v1/me/password',
    request: () => ({
      url: '/api/v1/me/password',
      payload: { currentPassword: PASSWORD, newPassword: 'another fine passphrase' },
    }),
    expect: authed(204),
  },
  {
    method: 'GET',
    url: '/api/v1/me/sessions',
    request: () => ({ url: '/api/v1/me/sessions' }),
    expect: authed(200),
  },
  {
    method: 'DELETE',
    url: '/api/v1/me/sessions/:id',
    request: () => ({ url: `/api/v1/me/sessions/${UUID}` }),
    expect: authed(404), // not the caller's session → 404, never 403
  },

  // ---- rooms -------------------------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/rooms',
    request: () => ({ url: '/api/v1/rooms' }),
    expect: authed(200),
  },
  {
    method: 'POST',
    url: '/api/v1/rooms',
    request: () => ({
      url: '/api/v1/rooms',
      payload: { name: 'Another room', firstBoard: { name: 'b', mapId: 'rondo' } },
    }),
    expect: authed(201),
  },
  {
    method: 'GET',
    url: '/api/v1/rooms/:roomId',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}` }),
    expect: room(200, 200, 200),
  },
  {
    method: 'PATCH',
    url: '/api/v1/rooms/:roomId',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}`, payload: { name: 'Renamed room' } }),
    expect: room(403, 403, 200),
  },
  {
    method: 'PUT',
    url: '/api/v1/rooms/:roomId/password',
    request: ({ f }) => ({
      url: `/api/v1/rooms/${f.roomId}/password`,
      payload: { password: 'abcd1234' },
    }),
    expect: room(403, 403, 204),
  },
  {
    method: 'DELETE',
    url: '/api/v1/rooms/:roomId',
    request: ({ f }) => ({
      url: `/api/v1/rooms/${f.roomId}`,
      payload: { confirmName: 'Team Soul Scrims' },
    }),
    expect: room(403, 403, 204),
  },
  {
    method: 'POST',
    url: '/api/v1/rooms/:roomId/leave',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/leave` }),
    expect: room(204, 204, 403), // the owner must transfer or delete first
  },
  {
    method: 'POST',
    url: '/api/v1/rooms/:roomId/transfer',
    request: ({ f }) => ({
      url: `/api/v1/rooms/${f.roomId}/transfer`,
      payload: { userId: f.editor.id, password: PASSWORD },
    }),
    expect: room(403, 403, 204),
  },

  // ---- members -----------------------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/rooms/:roomId/members',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/members` }),
    expect: room(200, 200, 200),
  },
  {
    method: 'PATCH',
    url: '/api/v1/rooms/:roomId/members/:userId',
    request: ({ f }) => ({
      url: `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}`,
      payload: { role: 'EDITOR' },
    }),
    expect: room(403, 403, 200),
  },
  {
    method: 'DELETE',
    url: '/api/v1/rooms/:roomId/members/:userId',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}` }),
    expect: room(403, 403, 204),
  },

  // ---- bans (kick + block) ----------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/rooms/:roomId/bans',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/bans` }),
    expect: room(403, 403, 200),
  },
  {
    method: 'DELETE',
    url: '/api/v1/rooms/:roomId/bans/:userId',
    request: ({ f, bannedId }) => ({ url: `/api/v1/rooms/${f.roomId}/bans/${bannedId}` }),
    expect: room(403, 403, 204),
  },

  // ---- invites -----------------------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/rooms/:roomId/invites',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/invites` }),
    expect: room(403, 200, 200),
  },
  {
    method: 'POST',
    url: '/api/v1/rooms/:roomId/invites',
    request: ({ f }) => ({
      url: `/api/v1/rooms/${f.roomId}/invites`,
      payload: { expiresIn: '24h', role: 'VIEWER' },
    }),
    expect: room(403, 201, 201),
  },
  {
    method: 'DELETE',
    url: '/api/v1/rooms/:roomId/invites/:inviteId',
    request: ({ f, inviteId }) => ({ url: `/api/v1/rooms/${f.roomId}/invites/${inviteId}` }), // created by the owner
    expect: room(403, 403, 204), // owner or the invite's creator
  },
  {
    method: 'GET',
    url: '/api/v1/invites/:code',
    request: ({ inviteCode }) => ({ url: `/api/v1/invites/${inviteCode}` }),
    expect: everyone(200),
  },
  {
    method: 'POST',
    url: '/api/v1/invites/:code/accept',
    request: ({ inviteCode }) => ({ url: `/api/v1/invites/${inviteCode}/accept`, payload: {} }),
    expect: { anonymous: 401, outsider: 200, viewer: 409, editor: 409, owner: 409 },
  },

  // ---- boards ------------------------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/rooms/:roomId/boards',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/boards` }),
    expect: room(200, 200, 200),
  },
  {
    method: 'POST',
    url: '/api/v1/rooms/:roomId/boards',
    request: ({ f }) => ({
      url: `/api/v1/rooms/${f.roomId}/boards`,
      payload: { name: 'New', mapId: 'miramar' },
    }),
    expect: room(403, 201, 201),
  },
  {
    method: 'PATCH',
    url: '/api/v1/boards/:boardId',
    request: ({ f }) => ({ url: `/api/v1/boards/${f.boardId}`, payload: { name: 'Renamed' } }),
    expect: room(403, 200, 200),
  },
  {
    method: 'DELETE',
    url: '/api/v1/boards/:boardId',
    request: ({ spareBoardId }) => ({ url: `/api/v1/boards/${spareBoardId}` }),
    expect: room(403, 403, 204),
  },
  {
    method: 'GET',
    url: '/api/v1/boards/:boardId/state',
    request: ({ f }) => ({ url: `/api/v1/boards/${f.boardId}/state` }),
    expect: room(200, 200, 200),
  },
  // ---- chat (Phase 7) ----------------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/rooms/:roomId/messages',
    request: ({ f }) => ({ url: `/api/v1/rooms/${f.roomId}/messages?limit=10` }),
    expect: room(200, 200, 200),
  },
  {
    method: 'DELETE',
    url: '/api/v1/messages/:messageId',
    request: ({ messageId }) => ({ url: `/api/v1/messages/${messageId}` }),
    // the editor wrote it; the owner may delete anything
    expect: room(403, 204, 204),
  },
  // ---- snapshots, account, email (Phase 8) ---------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/boards/:boardId/snapshots',
    request: ({ f }) => ({ url: `/api/v1/boards/${f.boardId}/snapshots` }),
    expect: room(200, 200, 200),
  },
  {
    method: 'POST',
    url: '/api/v1/boards/:boardId/snapshots',
    request: ({ f }) => ({
      url: `/api/v1/boards/${f.boardId}/snapshots`,
      payload: { name: 'Plan B' },
    }),
    expect: room(403, 201, 201),
  },
  {
    method: 'GET',
    url: '/api/v1/snapshots/:snapshotId',
    request: ({ snapshotId }) => ({ url: `/api/v1/snapshots/${snapshotId}` }),
    expect: room(200, 200, 200),
  },
  {
    method: 'POST',
    url: '/api/v1/snapshots/:snapshotId/restore',
    request: ({ snapshotId }) => ({ url: `/api/v1/snapshots/${snapshotId}/restore` }),
    expect: room(403, 200, 200),
  },
  {
    method: 'DELETE',
    url: '/api/v1/snapshots/:snapshotId',
    request: ({ snapshotId }) => ({ url: `/api/v1/snapshots/${snapshotId}` }),
    // the editor saved it; the owner may delete any
    expect: room(403, 204, 204),
  },
  {
    method: 'DELETE',
    url: '/api/v1/me',
    request: () => ({ url: '/api/v1/me', payload: { password: PASSWORD, confirm: 'DELETE' } }),
    expect: authed(204), // everyone may delete their own account
  },
  {
    method: 'GET',
    url: '/api/v1/public/demo-boards',
    request: () => ({ url: '/api/v1/public/demo-boards' }),
    expect: everyone(200), // no auth; only DEMO_BOARD_IDS are served (public-demo.test.ts)
  },
  // ---- thumbnails (Phase 11) -----------------------------------------------------------
  {
    method: 'PUT',
    url: '/api/v1/boards/:boardId/thumbnail',
    request: ({ f, jpeg }) => ({
      url: `/api/v1/boards/${f.boardId}/thumbnail`,
      payload: jpeg,
      headers: { 'content-type': 'image/jpeg' },
    }),
    expect: room(403, 200, 200),
  },
  {
    method: 'GET',
    url: '/api/v1/assets/thumbnails/:boardId/:file',
    request: ({ thumbnailUrl }) => ({ url: thumbnailUrl }),
    expect: everyone(200), // unguessable 128-bit key, like the S3 URLs (thumbnails.test.ts)
  },
  // ---- share links (Phase 11) ---------------------------------------------------------
  {
    method: 'GET',
    url: '/api/v1/boards/:boardId/share',
    request: ({ f }) => ({ url: `/api/v1/boards/${f.boardId}/share` }),
    expect: room(403, 200, 200),
  },
  {
    method: 'POST',
    url: '/api/v1/boards/:boardId/share',
    request: ({ f }) => ({
      url: `/api/v1/boards/${f.boardId}/share`,
      payload: { expiresIn: '7d' },
    }),
    expect: room(403, 201, 201),
  },
  {
    method: 'DELETE',
    url: '/api/v1/boards/:boardId/share',
    request: ({ f }) => ({ url: `/api/v1/boards/${f.boardId}/share` }),
    expect: room(403, 204, 204),
  },
  {
    method: 'GET',
    url: '/api/v1/public/share/:token',
    request: ({ shareToken }) => ({ url: `/api/v1/public/share/${shareToken}` }),
    expect: everyone(200), // the token is the only credential (share.test.ts)
  },
  {
    method: 'GET',
    url: '/api/v1/config',
    request: () => ({ url: '/api/v1/config' }),
    expect: everyone(200),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/verify-email',
    request: () => ({ url: '/api/v1/auth/verify-email', payload: { token: 'A'.repeat(43) } }),
    expect: everyone(400), // an unknown token, whoever asks
  },
  {
    method: 'POST',
    url: '/api/v1/auth/resend-verification',
    request: () => ({ url: '/api/v1/auth/resend-verification' }),
    expect: authed(202),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/forgot-password',
    request: () => ({
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'owner@example.com' },
    }),
    expect: everyone(202),
  },
  {
    method: 'POST',
    url: '/api/v1/auth/reset-password',
    request: () => ({
      url: '/api/v1/auth/reset-password',
      payload: { token: 'A'.repeat(43), password: 'a brand new passphrase' },
    }),
    expect: everyone(400),
  },
];

useCleanState();

let app: App;
beforeAll(async () => {
  ({ app } = await makeApp(
    { RATE_LIMITS_ENABLED: 'false', EMAIL_ENABLED: 'true', SMTP_HOST: 'smtp.invalid' },
    { mailer: createMemoryMailer() },
  ));
});

async function context(): Promise<Ctx> {
  const f = await setupRoom(app);
  const spare = await call(app, f.owner.jar, 'POST', `/api/v1/rooms/${f.roomId}/boards`, {
    name: 'Spare',
    mapId: 'rondo',
  });
  const inv = await invite(app, f.owner.jar, f.roomId);
  const banned = await register(app, new Jar(), {
    email: 'banned@example.com',
    username: 'banned',
  });
  const bannedId = banned.res.json<{ user: { id: string } }>().user.id;
  await accept(app, banned.jar, inv.code);
  await call(app, f.owner.jar, 'DELETE', `/api/v1/rooms/${f.roomId}/members/${bannedId}`, {
    ban: true,
  });
  const message = await prisma.chatMessage.create({
    data: {
      id: newId(),
      roomId: f.roomId,
      authorId: f.editor.id,
      body: 'matrix',
      clientId: randomUUID(),
    },
  });
  const snapshot = await call(app, f.editor.jar, 'POST', `/api/v1/boards/${f.boardId}/snapshots`, {
    name: 'Plan A',
  });
  const share = await call(app, f.owner.jar, 'POST', `/api/v1/boards/${f.boardId}/share`, {
    expiresIn: 'never',
  });
  const jpeg = await thumbJpeg();
  const thumb = await app.inject({
    method: 'PUT',
    url: `/api/v1/boards/${f.boardId}/thumbnail`,
    headers: { ...CSRF, 'content-type': 'image/jpeg' },
    cookies: f.owner.jar.cookies,
    payload: jpeg,
  });
  return {
    f,
    jpeg,
    thumbnailUrl: thumb.json<{ thumbnailUrl: string }>().thumbnailUrl,
    shareToken: share.json<{ url: string }>().url.split('/s/')[1] ?? '',
    messageId: message.id,
    snapshotId: snapshot.json<{ snapshot: { id: string } }>().snapshot.id,
    spareBoardId: spare.json<{ board: { id: string } }>().board.id,
    inviteCode: inv.code,
    inviteId: inv.id,
    bannedId,
  };
}

describe('authz matrix', () => {
  it('has exactly one row per registered route (add a row when you add a route)', () => {
    const registered = app.routeTable.map((r) => `${r.method} ${r.url}`).sort();
    const covered = MATRIX.map((r) => `${r.method} ${r.url}`).sort();
    expect(covered).toEqual(registered);
  });

  it('declares access "user" exactly where anonymous callers get 401', () => {
    for (const row of MATRIX) {
      const route = app.routeTable.find((r) => r.method === row.method && r.url === row.url);
      if (route?.access === 'user')
        expect(row.expect.anonymous, `${row.method} ${row.url}`).toBe(401);
    }
  });

  for (const row of MATRIX) {
    for (const caller of CALLERS) {
      it(`${row.method} ${row.url} as ${caller} → ${row.expect[caller]}`, async () => {
        const ctx = await context();
        const { url, payload, headers } = row.request(ctx);
        const res = await app.inject({
          method: row.method,
          url,
          headers: { ...(row.method === 'GET' ? {} : CSRF), ...headers },
          cookies: caller === 'anonymous' ? {} : ctx.f[caller].jar.cookies,
          ...(payload ? { payload } : {}),
        });
        expect(res.statusCode, res.body).toBe(row.expect[caller]);
      });
    }
  }
});
