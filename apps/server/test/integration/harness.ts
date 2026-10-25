import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, inject } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { CSRF, captureLogs, testConfig } from '../helpers.js';

export { CSRF };

export const prisma = new PrismaClient({ datasourceUrl: inject('databaseUrl') });
export const redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: 1 });

const apps: App[] = [];

/** Fresh app per call (config overrides allowed). Logs are captured, never printed. */
export async function makeApp(overrides: Record<string, string> = {}) {
  const logs = captureLogs();
  const config = testConfig({
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    LOG_LEVEL: 'trace',
    ...overrides,
  });
  const app = await buildApp({ config, prisma, redis, logStream: logs });
  apps.push(app);
  await app.ready();
  return { app, logs, config };
}

/** Clean slate per test: Postgres tables truncated, Redis test DB flushed. */
export function useCleanState() {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE layers, boards, room_invites, room_members, rooms, refresh_tokens, email_tokens, users RESTART IDENTITY CASCADE',
    );
    await redis.flushdb();
  });
  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await prisma.$disconnect();
    redis.disconnect();
  });
}

// ---- cookies ---------------------------------------------------------------------------

export interface SetCookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
}

export function setCookies(res: LightMyRequestResponse): SetCookie[] {
  const raw = res.headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.map((line) => {
    const [pair = '', ...rest] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const attrs: Record<string, string | true> = {};
    for (const a of rest) {
      const i = a.indexOf('=');
      if (i === -1) attrs[a.toLowerCase()] = true;
      else attrs[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
    }
    return { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)), attrs };
  });
}

/** A tiny cookie jar: remembers cookies across requests like a browser would (ignores Path). */
export class Jar {
  cookies: Record<string, string> = {};
  absorb(res: LightMyRequestResponse) {
    for (const c of setCookies(res)) {
      const expired = c.attrs['max-age'] === '0' || c.value === '';
      if (expired) Reflect.deleteProperty(this.cookies, c.name);
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
}

// ---- common flows ----------------------------------------------------------------------

export const PASSWORD = 'correct horse battery staple';

export async function register(
  app: App,
  jar = new Jar(),
  body: Partial<{ email: string; username: string; password: string; displayName: string }> = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: CSRF,
    payload: { email: 'alice@example.com', username: 'alice', password: PASSWORD, ...body },
  });
  jar.absorb(res);
  return { res, jar };
}

export async function login(app: App, identifier: string, password = PASSWORD, jar = new Jar()) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { identifier, password },
  });
  jar.absorb(res);
  return { res, jar };
}

export function call(
  app: App,
  jar: Jar,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app
    .inject({
      method,
      url,
      headers: method === 'GET' ? {} : CSRF,
      cookies: jar.cookies,
      ...(payload === undefined ? {} : { payload: payload as object }),
    })
    .then((r) => jar.absorb(r));
}

// ---- room fixture ----------------------------------------------------------------------

export interface RoomFixture {
  roomId: string;
  boardId: string;
  owner: { id: string; jar: Jar };
  editor: { id: string; jar: Jar };
  viewer: { id: string; jar: Jar };
  outsider: { id: string; jar: Jar };
}

async function newUser(app: App, name: string) {
  const { res, jar } = await register(app, new Jar(), {
    email: `${name}@example.com`,
    username: name,
  });
  if (res.statusCode !== 201) throw new Error(`register ${name}: ${res.statusCode} ${res.body}`);
  return { id: res.json<{ user: { id: string } }>().user.id, jar };
}

export async function createRoom(app: App, jar: Jar, body: Record<string, unknown> = {}) {
  const res = await call(app, jar, 'POST', '/api/v1/rooms', {
    name: 'Team Soul Scrims',
    firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
    ...body,
  });
  if (res.statusCode !== 201) throw new Error(`create room: ${res.statusCode} ${res.body}`);
  return res.json<{ room: { id: string }; board: { id: string } }>();
}

export async function invite(
  app: App,
  jar: Jar,
  roomId: string,
  body: Record<string, unknown> = {},
) {
  const res = await call(app, jar, 'POST', `/api/v1/rooms/${roomId}/invites`, {
    expiresIn: '24h',
    ...body,
  });
  if (res.statusCode !== 201) throw new Error(`invite: ${res.statusCode} ${res.body}`);
  return res.json<{ invite: { id: string; code: string; url: string } }>().invite;
}

export function accept(app: App, jar: Jar, code: string, body: Record<string, unknown> = {}) {
  return call(app, jar, 'POST', `/api/v1/invites/${code}/accept`, body);
}

/** Owner + editor + viewer in one room with one board, plus an outsider. */
export async function setupRoom(app: App): Promise<RoomFixture> {
  const owner = await newUser(app, 'owner');
  const editor = await newUser(app, 'editor');
  const viewer = await newUser(app, 'viewer');
  const outsider = await newUser(app, 'outsider');
  const { room, board } = await createRoom(app, owner.jar);
  const ei = await invite(app, owner.jar, room.id, { role: 'EDITOR' });
  const vi = await invite(app, owner.jar, room.id, { role: 'VIEWER' });
  for (const [u, code] of [
    [editor, ei.code],
    [viewer, vi.code],
  ] as const) {
    const r = await accept(app, u.jar, code);
    if (r.statusCode !== 200) throw new Error(`accept: ${r.statusCode} ${r.body}`);
  }
  return { roomId: room.id, boardId: board.id, owner, editor, viewer, outsider };
}
