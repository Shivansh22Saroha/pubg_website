import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { LightMyRequestResponse } from 'fastify';
import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, ServerToClientEvents } from '@rotationlab/shared';
import { io as ioClient, type Socket as ClientSocketBase } from 'socket.io-client';
import { afterAll, afterEach, beforeEach, inject } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import type { Mailer } from '../../src/lib/mailer.js';
import { APP_ORIGIN, CSRF, captureLogs, testConfig } from '../helpers.js';

export { CSRF };

export const prisma = new PrismaClient({ datasourceUrl: inject('databaseUrl') });
export const redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: 1 });

const apps: App[] = [];

/** Fresh app per call (config overrides allowed). Logs are captured, never printed. */
export async function makeApp(
  overrides: Record<string, string> = {},
  opts: { mailer?: Mailer } = {},
) {
  const logs = captureLogs();
  const config = testConfig({
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    LOG_LEVEL: 'trace',
    ...overrides,
  });
  const app = await buildApp({ config, prisma, redis, logStream: logs, ...opts });
  apps.push(app);
  await app.ready();
  return { app, logs, config };
}

/** Clean slate per test: Postgres tables truncated, Redis test DB flushed. */
export function useCleanState() {
  beforeEach(async () => {
    // fire-and-forget system messages of the previous test would deadlock with TRUNCATE
    await Promise.all(apps.map((a) => a.chatIdle()));
    // ops a previous test's socket sent are still applied after it ends (the server works
    // through what it already received): their transactions can deadlock with TRUNCATE → retry
    for (let attempt = 1; ; attempt++) {
      try {
        await prisma.$executeRawUnsafe(
          'TRUNCATE TABLE audit_logs, snapshots, chat_messages, board_ops, elements, room_bans, layers, boards, room_invites, room_members, rooms, refresh_tokens, email_tokens, users RESTART IDENTITY CASCADE',
        );
        break;
      } catch (err) {
        if (attempt >= 5 || !String(err).includes('40P01')) throw err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
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

// ---- realtime ----------------------------------------------------------------------------

export type ClientSocket = ClientSocketBase<ServerToClientEvents, ClientToServerEvents>;

const openSockets: ClientSocket[] = [];
afterEach(() => {
  for (const s of openSockets.splice(0)) s.disconnect();
});

/** Starts the app's HTTP server (Socket.IO rides on it) on a random port. */
export async function listen(app: App): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

export function cookieHeader(jar: Jar): string {
  return Object.entries(jar.cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
}

/** Connects like the browser would: websocket, cookies, Origin. Rejects with the connect_error. */
export function connect(
  url: string,
  jar: Jar | null,
  opts: { origin?: string; cookie?: string } = {},
): Promise<ClientSocket> {
  const headers: Record<string, string> = { origin: opts.origin ?? APP_ORIGIN };
  const cookie = opts.cookie ?? (jar ? cookieHeader(jar) : '');
  if (cookie) headers.cookie = cookie;
  const socket: ClientSocket = ioClient(url, {
    path: '/realtime',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: headers,
  });
  openSockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', (err: Error & { data?: { code?: string } }) => {
      reject(err);
    });
  });
}

/** emit + ack with a timeout; returns the raw ack `{ ok, data } | { ok:false, code }`. */
export function ack(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; code?: string; message?: string; data?: any }> {
  return (
    socket.timeout(5000) as unknown as { emitWithAck: (e: string, p: unknown) => Promise<any> }
  ).emitWithAck(event, payload);
}

/** Resolves with the next `event` (or rejects after `ms`). */
export function nextEvent<T = any>(socket: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    (socket as unknown as { once: (e: string, f: (p: T) => void) => void }).once(event, (p: T) => {
      clearTimeout(timer);
      resolve(p);
    });
  });
}

/** Records every `event` the socket receives. */
export function collect<T = any>(socket: ClientSocket, event: string): T[] {
  const seen: T[] = [];
  (socket as unknown as { on: (e: string, f: (p: T) => void) => void }).on(event, (p: T) =>
    seen.push(p),
  );
  return seen;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** room:join + board:subscribe; returns the full board state from the ack. */
export async function joinBoard(socket: ClientSocket, roomId: string, boardId: string) {
  const j = await ack(socket, 'room:join', { roomId });
  if (!j.ok) throw new Error(`room:join ${j.code}`);
  const s = await ack(socket, 'board:subscribe', { boardId });
  if (!s.ok) throw new Error(`board:subscribe ${s.code}`);
  return s.data as {
    mode: 'full';
    layers: { id: string; name: string }[];
    elements: any[];
    seq: number;
  };
}

export const STYLE = { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 } as const;

export function arrow(boardId: string, layerId: string, over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    boardId,
    layerId,
    type: 'ARROW',
    geometry: {
      points: [
        [10_000, 10_000],
        [200_000, 300_000],
      ],
    },
    style: STYLE,
    props: {},
    z: 0,
    ...over,
  };
}

export const opId = () => randomUUID();
