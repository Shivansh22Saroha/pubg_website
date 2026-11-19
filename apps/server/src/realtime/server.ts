import { createAdapter } from '@socket.io/redis-adapter';
import {
  BoardSubscribeSchema,
  can,
  ChatSendSchema,
  ChatTypingSchema,
  CursorMoveSchema,
  ElementBatchSchema,
  ElementDeleteSchema,
  ElementUpsertSchema,
  FollowSchema,
  LaserPointSchema,
  LayerClearSchema,
  LayerDeleteSchema,
  LayerReorderSchema,
  LayerUpsertSchema,
  PresenceHeartbeatSchema,
  CURSOR_FLUSH_MS,
  REALTIME_PATH,
  RoomJoinSchema,
  RoomLeaveSchema,
  StrokePreviewSchema,
  SummonSchema,
  ViewUpdateSchema,
  VOICE_MAX_PEERS,
  VoiceJoinSchema,
  VoiceLeaveSchema,
  VoiceMuteSchema,
  VoiceSignalSchema,
  type AckResult,
  type BoardOp,
  type ClientToServerEvents,
  type ErrorCode,
  type ServerToClientEvents,
  type VoicePeer,
} from '@rotationlab/shared';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { AuthUser } from '../lib/policy.js';
import type { RevocationList } from '../modules/auth/revocation.js';
import type { SocketTickets } from '../modules/auth/socketTickets.js';
import type { TokenService } from '../modules/auth/tokens.js';
import type { ChatService } from '../modules/chat/service.js';
import type { BoardOpsService, OpRequest } from '../modules/elements/service.js';
import type { RoomEvents } from '../modules/rooms/events.js';
import type { RoomPolicy } from '../modules/rooms/policy.js';
import type { RoomService } from '../modules/rooms/service.js';
import type { IceProvider } from '../modules/voice/turn.js';
import { createPresence, type PresenceStore } from './presence.js';
import { createSocketLimiter, type LimitGroup } from './rateLimiter.js';

export const MAX_SOCKETS_PER_USER = 5;
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Every client → server event this phase handles (authz matrix: one row each). */
export const ACKED_EVENTS = [
  'room:join',
  'room:leave',
  'board:subscribe',
  'element:upsert',
  'element:delete',
  'element:batch',
  'layer:upsert',
  'layer:delete',
  'layer:reorder',
  'layer:clear',
  'presence:heartbeat',
  'follow:start',
  'follow:stop',
  'summon',
  'chat:send',
  'voice:join',
  'voice:leave',
  'voice:mute',
] as const;
export const VOLATILE_EVENTS = [
  'cursor:move',
  'stroke:preview',
  'laser:point',
  'view:update',
  'chat:typing',
] as const;
/** reliable but un-acked: relayed to one socket (voice signalling, FEATURES F19) */
export const RELAYED_EVENTS = ['voice:signal'] as const;

/** voice joins per user per 10 min — each one mints TURN credentials (SECURITY VC2) */
export const VOICE_JOINS_PER_10_MIN = 30;

/** Phase 11: a socket's typing pings are relayed at most once per 2 s (FEATURES F9) */
export const TYPING_INTERVAL_MS = 2_000;

/** Serialisable per-socket state (RemoteSocket.data survives fetchSockets across instances). */
export interface SocketData {
  userId: string;
  sid: string;
  rooms: string[];
  boardId: string | null;
  boardRoomId: string | null;
  /** access token expiry, epoch seconds */
  exp: number;
  /** the room voice channel this socket is in (FEATURES F19) */
  voice: { roomId: string; muted: boolean } | null;
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type RtSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface RealtimeDeps {
  app: FastifyInstance;
  redis: Redis;
  appOrigin: string;
  accessCookieName: string;
  tokens: TokenService;
  /** cross-site deployments: single-use tickets instead of the access cookie (SECURITY A11) */
  tickets: SocketTickets;
  revocations: RevocationList;
  policy: RoomPolicy;
  rooms: RoomService;
  boardOps: BoardOpsService;
  chat: ChatService;
  events: RoomEvents;
  /** voice relay credentials (Cloudflare TURN, or STUN only) */
  ice: IceProvider;
  /** disconnect this long after the access token's exp (sessions never outlive their token) */
  tokenGraceSec: number;
}

/** how long a socket's cursor stream trusts its last membership check */
const CURSOR_MEMBER_TTL_MS = 5000;

const ch = {
  room: (id: string) => `room:${id}`,
  board: (id: string) => `board:${id}`,
  user: (id: string) => `user:${id}`,
  session: (sid: string) => `session:${sid}`,
  followers: (userId: string) => `follow:${userId}`,
  voice: (roomId: string) => `voice:${roomId}`,
};

function connectError(code: ErrorCode, message: string) {
  return Object.assign(new Error(message), { data: { code } });
}

function toAckError(err: unknown): AckResult<never> {
  if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
  return { ok: false, code: 'INTERNAL', message: 'Something went wrong' };
}

/**
 * Socket.IO server (ARCHITECTURE §7, API_SPEC §7) on the Fastify HTTP server. Redis adapter so
 * several instances share channels; every event re-checks membership/role via the room policy
 * (Redis-cached, busted on change), so a role downgrade or kick applies on the very next event.
 */
export function createRealtime(d: RealtimeDeps): {
  io: RealtimeServer;
  presence: PresenceStore;
  close: () => Promise<void>;
} {
  const pub = d.redis.duplicate();
  const sub = d.redis.duplicate();
  const io: RealtimeServer = new Server(d.app.server, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    perMessageDeflate: { threshold: 1024 },
    adapter: createAdapter(pub, sub),
  });
  const presence = createPresence(d.redis);
  const log = d.app.log.child({ module: 'realtime' });

  // ---- live cursors (Phase 10): buffered per board, flushed as one `cursor:batch` per tick ----
  // boardId → userId → latest position since the last flush (only cursors from this instance;
  // the adapter fans each batch out to every instance's subscribers)
  const cursorBuffers = new Map<string, Map<string, { x: number; y: number }>>();
  const cursorTimer = setInterval(() => {
    for (const [boardId, byUser] of cursorBuffers) {
      const cursors = [...byUser].map(([userId, p]) => ({ userId, x: p.x, y: p.y }));
      io.to(ch.board(boardId)).volatile.emit('cursor:batch', { boardId, cursors });
    }
    cursorBuffers.clear();
  }, CURSOR_FLUSH_MS);
  cursorTimer.unref();

  // ---- handshake (API_SPEC §7.1, SECURITY T2) ------------------------------------------
  io.use((socket, next) => {
    void (async () => {
      if (socket.handshake.headers.origin !== d.appOrigin) {
        next(connectError('FORBIDDEN', 'Origin not allowed'));
        return;
      }
      const token = d.app.parseCookie(socket.handshake.headers.cookie ?? '')[d.accessCookieName];
      const ticket = (socket.handshake.auth as { ticket?: unknown } | undefined)?.ticket;
      if (!token && ticket === undefined) {
        next(connectError('UNAUTHENTICATED', 'Log in to continue'));
        return;
      }
      try {
        // the access cookie when it reaches us (same site); otherwise a single-use ticket
        // fetched over the web origin's REST rewrite (e.g. Vercel + Render, SECURITY A11)
        let claims: { sub: string; sid: string; exp: number };
        if (token) {
          claims = await d.tokens.verify(token);
        } else {
          const t = await d.tickets.redeem(ticket);
          if (!t) throw new AppError('UNAUTHENTICATED', 'Invalid or used socket ticket');
          if (t.exp * 1000 <= Date.now()) throw new AppError('TOKEN_EXPIRED', 'Session expired');
          claims = { sub: t.userId, sid: t.sid, exp: t.exp };
        }
        if (await d.revocations.isRevoked(claims.sid))
          throw new AppError('UNAUTHENTICATED', 'Session ended');
        const existing = await io.in(ch.user(claims.sub)).fetchSockets();
        if (existing.length >= MAX_SOCKETS_PER_USER) {
          next(
            connectError('LIMIT_REACHED', `At most ${MAX_SOCKETS_PER_USER} connections per user`),
          );
          return;
        }
        socket.data = {
          userId: claims.sub,
          sid: claims.sid,
          rooms: [],
          boardId: null,
          boardRoomId: null,
          exp: claims.exp,
          voice: null,
        };
        next();
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'UNAUTHENTICATED';
        next(
          connectError(
            code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
            'Authentication failed',
          ),
        );
      }
    })();
  });

  let closing = false;

  // ---- presence broadcast ---------------------------------------------------------------
  /** Never rejects (it is often fire-and-forget): a Redis failure is logged, not thrown. */
  async function broadcastPresence(roomId: string) {
    try {
      const users = await presence.list(roomId);
      // shutting down: the adapter would publish on Redis clients that are quitting, and its
      // rejected publish isn't returned to us (seen as unhandled "Connection is closed")
      if (closing) return;
      io.to(ch.room(roomId)).emit('presence:update', { roomId, users });
    } catch (err) {
      log.warn({ err, roomId }, 'presence broadcast failed');
    }
  }

  /** Tells a leader (all their sockets) how many sockets follow them — never rejects. */
  async function notifyFollowers(leaderId: string, only?: RtSocket) {
    // shutting down: the adapter's request would publish on clients that are quitting, and the
    // adapter doesn't handle that rejection itself
    if (closing) return;
    try {
      const count = (await io.in(ch.followers(leaderId)).fetchSockets()).length;
      if (only) only.emit('followers:update', { count });
      else io.to(ch.user(leaderId)).emit('followers:update', { count });
    } catch (err) {
      log.warn({ err }, 'follower count failed');
    }
  }

  // ---- voice (FEATURES F19) --------------------------------------------------------------
  // The channel's members are the sockets in the `voice:<roomId>` Socket.IO room — the adapter
  // keeps that true across instances and drops a socket the moment it disconnects, so there
  // is no separate list to go stale. `socket.data.voice` carries the mute flag.

  async function voicePeers(roomId: string): Promise<VoicePeer[]> {
    const sockets = await io.in(ch.voice(roomId)).fetchSockets();
    return sockets
      .map((s) => ({ peerId: s.id, userId: s.data.userId, muted: s.data.voice?.muted ?? true }))
      .sort((a, b) => a.peerId.localeCompare(b.peerId));
  }

  /** Never rejects (often fire-and-forget): a Redis failure is logged, not thrown. */
  async function broadcastVoice(roomId: string) {
    try {
      const peers = await voicePeers(roomId);
      if (closing) return;
      io.to(ch.room(roomId)).emit('voice:peers', { roomId, peers });
    } catch (err) {
      log.warn({ err, roomId }, 'voice broadcast failed');
    }
  }

  /** Serialises joins per room across instances so the cap holds (a short Redis lock). */
  async function withVoiceLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const key = `voice:lock:${roomId}`;
    const token = `${process.pid}:${Math.random()}`;
    for (let i = 0; i < 40; i += 1) {
      if ((await d.redis.set(key, token, 'PX', 3_000, 'NX')) === 'OK') {
        try {
          return await fn();
        } finally {
          // release only our own lock (it may have expired and been taken meanwhile)
          await d.redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
            1,
            key,
            token,
          );
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new AppError('CONFLICT', 'Voice is busy — try again');
  }

  function broadcastOps(socket: RtSocket, boardId: string, ops: BoardOp[]) {
    for (const op of ops) socket.to(ch.board(boardId)).emit('board:op', op);
  }

  io.on('connection', (socket: RtSocket) => {
    const user: AuthUser = { id: socket.data.userId, sid: socket.data.sid };
    void socket.join([ch.user(user.id), ch.session(user.sid)]);
    const limiter = createSocketLimiter();
    // Acked events from one socket run one at a time, in emit order: a client may pipeline
    // `upsert` then `delete` of the same element (or `room:join` then `board:subscribe`) and
    // must see them applied in that order. Volatile events bypass the queue.
    let queue: Promise<unknown> = Promise.resolve();

    // session expiry: tell the client when to refresh, and drop the socket once the token is
    // well past its exp — one timer per socket, cleared on disconnect
    socket.emit('session', { expiresAt: socket.data.exp * 1000 });
    const expiryTimer = setTimeout(
      () => {
        socket.emit('error', { code: 'TOKEN_EXPIRED', message: 'Session token expired' });
        socket.disconnect(true);
      },
      Math.max(0, socket.data.exp * 1000 + d.tokenGraceSec * 1000 - Date.now()),
    );

    function requireJoined(roomId: string) {
      if (!socket.data.rooms.includes(roomId))
        throw new AppError('FORBIDDEN', 'Join the room first');
    }

    /** Acked event: rate limit → Zod → handler → { ok, data } | { ok:false, code, message }. */
    function on<S extends z.ZodType, R>(
      event: (typeof ACKED_EVENTS)[number],
      schema: S,
      group: LimitGroup,
      handler: (payload: z.output<S>) => Promise<R>,
    ) {
      (socket.on as (ev: string, fn: (payload: unknown, ack?: unknown) => void) => void)(
        event,
        (payload, ack) => {
          const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => undefined;
          if (!limiter.take(group)) {
            reply({ ok: false, code: 'RATE_LIMITED', message: 'Slow down' });
            if (limiter.violation()) {
              log.warn({ userId: user.id, event }, 'socket rate-limit abuse — disconnecting');
              socket.disconnect(true);
            }
            return;
          }
          const parsed = schema.safeParse(payload);
          if (!parsed.success) {
            reply({
              ok: false,
              code: 'VALIDATION_ERROR',
              message: parsed.error.issues[0]?.message ?? 'Invalid payload',
            });
            return;
          }
          queue = queue.then(() =>
            handler(parsed.data).then(
              (data) => {
                reply(data === undefined ? { ok: true } : { ok: true, data });
              },
              (err: unknown) => {
                if (!(err instanceof AppError)) log.error({ err, event }, 'socket handler failed');
                reply(toAckError(err));
              },
            ),
          );
        },
      );
    }

    /** Volatile event: dropped silently when over the cap, invalid, or not subscribed. */
    function onVolatile<S extends z.ZodType>(
      event: (typeof VOLATILE_EVENTS)[number],
      schema: S,
      handler: (payload: z.output<S>) => Promise<void>,
    ) {
      (socket.on as (ev: string, fn: (payload: unknown) => void) => void)(event, (payload) => {
        if (!limiter.take('volatile')) return;
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return;
        handler(parsed.data).catch(() => undefined);
      });
    }

    /** Ephemeral events only flow on the board the socket is subscribed to, while a member. */
    async function subscribedBoard(boardId: string): Promise<string | null> {
      if (socket.data.boardId !== boardId || !socket.data.boardRoomId) return null;
      return (await d.policy.roleOf(socket.data.boardRoomId, user.id)) ? boardId : null;
    }

    /**
     * `subscribedBoard` for the 20 Hz cursor stream: the membership answer is reused for
     * CURSOR_MEMBER_TTL_MS instead of one role lookup per move. Safe because a kick or a removed
     * room disconnects the socket at once (SECURITY Z5) — the board check itself is per call.
     */
    let cursorMember: { roomId: string; until: number } | null = null;
    async function cursorAllowed(boardId: string): Promise<boolean> {
      const roomId = socket.data.boardRoomId;
      if (socket.data.boardId !== boardId || !roomId) return false;
      if (cursorMember?.roomId === roomId && cursorMember.until > Date.now()) return true;
      if (!(await d.policy.roleOf(roomId, user.id))) return false;
      cursorMember = { roomId, until: Date.now() + CURSOR_MEMBER_TTL_MS };
      return true;
    }

    async function applyOps(boardId: string, ops: OpRequest[]) {
      const resolved = await d.policy.requireBoard(user, boardId, 'board.edit');
      requireJoined(resolved.board.roomId);
      const result = await d.boardOps.applyResolved(user, resolved, ops);
      if (!result.replay) broadcastOps(socket, boardId, result.ops);
      return result.seqs;
    }

    // ---- rooms & presence ---------------------------------------------------------------
    on('room:join', RoomJoinSchema, 'durable', async ({ roomId }) => {
      const detail = await d.rooms.detail(user, roomId); // policy: room.view (404 for outsiders)
      await socket.join(ch.room(roomId));
      if (!socket.data.rooms.includes(roomId)) socket.data.rooms = [...socket.data.rooms, roomId];
      await presence.join(roomId, user.id, socket.id);
      const online = await presence.list(roomId);
      void broadcastPresence(roomId);
      void notifyFollowers(user.id, socket); // a reconnecting leader learns its follower count
      // who is in the voice channel right now (later changes arrive as broadcasts)
      voicePeers(roomId)
        .then((peers) => {
          socket.emit('voice:peers', { roomId, peers });
        })
        .catch(() => undefined);
      const onlineIds = new Set(online.map((p) => p.userId));
      return {
        room: { ...detail.room, onlineCount: onlineIds.size },
        members: detail.members.map((m) => ({ ...m, online: onlineIds.has(m.user.id) })),
        presence: online,
        boards: detail.boards,
      };
    });

    async function leaveRoom(roomId: string) {
      if (myVoice()?.roomId === roomId) await leaveVoice();
      await socket.leave(ch.room(roomId));
      if (socket.data.boardRoomId === roomId && socket.data.boardId) {
        await socket.leave(ch.board(socket.data.boardId));
        socket.data.boardId = null;
        socket.data.boardRoomId = null;
      }
      socket.data.rooms = socket.data.rooms.filter((r) => r !== roomId);
      await presence.leave(roomId, user.id, socket.id);
      await broadcastPresence(roomId);
    }

    on('room:leave', RoomLeaveSchema, 'durable', async ({ roomId }) => {
      requireJoined(roomId);
      await leaveRoom(roomId);
    });

    on(
      'presence:heartbeat',
      PresenceHeartbeatSchema,
      'durable',
      async ({ roomId, boardId, idle }) => {
        requireJoined(roomId);
        await d.policy.requireRoom(user, roomId, 'room.view');
        await presence.update(roomId, user.id, socket.id, {
          boardId: boardId ?? socket.data.boardId,
          idle,
        });
        await broadcastPresence(roomId);
      },
    );

    // ---- boards -------------------------------------------------------------------------
    on('board:subscribe', BoardSubscribeSchema, 'durable', async ({ boardId, sinceSeq }) => {
      const { board } = await d.policy.requireBoard(user, boardId, 'room.view');
      requireJoined(board.roomId);
      const { ack } = await d.boardOps.subscribe(user, boardId, sinceSeq);
      if (socket.data.boardId && socket.data.boardId !== boardId)
        await socket.leave(ch.board(socket.data.boardId));
      await socket.join(ch.board(boardId));
      socket.data.boardId = boardId;
      socket.data.boardRoomId = board.roomId;
      await presence.update(board.roomId, user.id, socket.id, { boardId, idle: false });
      void broadcastPresence(board.roomId);
      return ack;
    });

    on('element:upsert', ElementUpsertSchema, 'durable', async ({ opId, boardId, element }) => {
      const [seq] = await applyOps(boardId, [{ opId, kind: 'element:upsert', element }]);
      return { seq: seq ?? 0 };
    });

    on('element:delete', ElementDeleteSchema, 'durable', async ({ opId, boardId, elementId }) => {
      const [seq] = await applyOps(boardId, [{ opId, kind: 'element:delete', elementId }]);
      return { seq: seq ?? 0 };
    });

    on('element:batch', ElementBatchSchema, 'durable', async ({ boardId, ops }) => {
      const requests: OpRequest[] = ops.map((o) =>
        o.kind === 'upsert'
          ? { opId: o.opId, kind: 'element:upsert', element: o.element }
          : { opId: o.opId, kind: 'element:delete', elementId: o.elementId },
      );
      return { seqs: await applyOps(boardId, requests) };
    });

    on('layer:upsert', LayerUpsertSchema, 'durable', async ({ opId, boardId, layer }) => {
      const [seq] = await applyOps(boardId, [{ opId, kind: 'layer:upsert', layer }]);
      return { seq: seq ?? 0 };
    });

    on('layer:delete', LayerDeleteSchema, 'durable', async ({ opId, boardId, layerId }) => {
      const [seq] = await applyOps(boardId, [{ opId, kind: 'layer:delete', layerId }]);
      return { seq: seq ?? 0 };
    });

    on('layer:reorder', LayerReorderSchema, 'durable', async ({ opId, boardId, order }) => {
      const [seq] = await applyOps(boardId, [{ opId, kind: 'layer:reorder', order }]);
      return { seq: seq ?? 0 };
    });

    on('layer:clear', LayerClearSchema, 'durable', async ({ opId, boardId, layerId }) => {
      const [seq] = await applyOps(boardId, [{ opId, kind: 'layer:clear', layerId }]);
      return { seq: seq ?? 0 };
    });

    // ---- follow & summon (RT-5) ----------------------------------------------------------
    async function sharedRoom(targetUserId: string) {
      for (const roomId of socket.data.rooms) {
        if (await d.policy.roleOf(roomId, targetUserId)) return roomId;
      }
      throw new AppError('NOT_FOUND', 'User not found in your rooms');
    }

    on('follow:start', FollowSchema, 'durable', async ({ targetUserId }) => {
      await d.policy.requireRoom(user, await sharedRoom(targetUserId), 'room.view');
      await socket.join(ch.followers(targetUserId));
      void notifyFollowers(targetUserId);
    });

    on('follow:stop', FollowSchema, 'durable', async ({ targetUserId }) => {
      await socket.leave(ch.followers(targetUserId));
      void notifyFollowers(targetUserId);
    });

    on('summon', SummonSchema, 'durable', async ({ boardId }) => {
      const { board, role } = await d.policy.requireBoard(user, boardId, 'room.view');
      requireJoined(board.roomId);
      if (!can(role, 'board.edit'))
        throw new AppError('FORBIDDEN', 'Only owners and editors can summon');
      socket.to(ch.room(board.roomId)).emit('summon', { userId: user.id, boardId });
    });

    // ---- chat (CHAT-1…6) ----------------------------------------------------------------
    // the stored message is broadcast by the `chat:message` domain event (one path for user and
    // system messages); a replayed clientId is not broadcast again
    on('chat:send', ChatSendSchema, 'chat', async (p) => {
      requireJoined(p.roomId);
      const { message } = await d.chat.send(user, p);
      return { message };
    });

    // ---- ephemeral (volatile, never persisted) ---------------------------------------------
    onVolatile('cursor:move', CursorMoveSchema, async (p) => {
      if (!(await cursorAllowed(p.boardId))) return;
      let byUser = cursorBuffers.get(p.boardId);
      if (!byUser) {
        byUser = new Map<string, { x: number; y: number }>();
        cursorBuffers.set(p.boardId, byUser);
      }
      byUser.set(user.id, { x: p.x, y: p.y });
    });
    onVolatile('laser:point', LaserPointSchema, async (p) => {
      if (await subscribedBoard(p.boardId))
        socket.volatile.to(ch.board(p.boardId)).emit('laser:point', { userId: user.id, ...p });
    });
    onVolatile('stroke:preview', StrokePreviewSchema, async (p) => {
      // previews are drawing — only for roles that may draw
      if (!(await subscribedBoard(p.boardId)) || !socket.data.boardRoomId) return;
      if (!can(await d.policy.roleOf(socket.data.boardRoomId, user.id), 'board.edit')) return;
      socket.volatile.to(ch.board(p.boardId)).emit('stroke:preview', { userId: user.id, ...p });
    });
    onVolatile('view:update', ViewUpdateSchema, async (p) => {
      if (await subscribedBoard(p.boardId))
        socket.volatile.to(ch.followers(user.id)).emit('view:update', { userId: user.id, ...p });
    });

    // typing indicator (Phase 11): to the rest of the room, ≤ 1 per 2 s per socket; only after
    // room:join and while still a member (room.interact — viewers chat too)
    let lastTyping = 0;
    onVolatile('chat:typing', ChatTypingSchema, async ({ roomId }) => {
      const now = Date.now();
      if (now - lastTyping < TYPING_INTERVAL_MS) return;
      if (!socket.data.rooms.includes(roomId)) return;
      if (!can(await d.policy.roleOf(roomId, user.id), 'room.interact')) return;
      lastTyping = now;
      socket.volatile.to(ch.room(roomId)).emit('chat:typing', { userId: user.id });
    });

    // ---- voice (FEATURES F19, SECURITY VC1–VC3) -------------------------------------------
    /**
     * The room's voice channel this socket is really in. Channel membership is the truth —
     * another tab joining takes this socket out of the channel from wherever it runs, which
     * can't reach `socket.data` here, so a stale flag is cleared on the next look.
     */
    function myVoice(): { roomId: string; muted: boolean } | null {
      const v = socket.data.voice;
      if (v && !socket.rooms.has(ch.voice(v.roomId))) socket.data.voice = null;
      return socket.data.voice;
    }

    /** take this socket out of its voice channel (if any) and tell the room */
    async function leaveVoice() {
      const v = socket.data.voice;
      if (!v) return;
      socket.data.voice = null;
      await socket.leave(ch.voice(v.roomId));
      await broadcastVoice(v.roomId);
    }

    on('voice:join', VoiceJoinSchema, 'durable', async ({ roomId }) => {
      requireJoined(roomId);
      await d.policy.requireRoom(user, roomId, 'room.interact');
      // each join mints relay credentials: a per-user budget on top of the socket bucket
      const budgetKey = `rl:voice:${user.id}`;
      const used = await d.redis.incr(budgetKey);
      if (used === 1) await d.redis.expire(budgetKey, 600);
      if (used > VOICE_JOINS_PER_10_MIN)
        throw new AppError('RATE_LIMITED', 'Too many voice joins — wait a few minutes');
      const current = myVoice();
      if (current && current.roomId !== roomId) await leaveVoice();
      await withVoiceLock(roomId, async () => {
        const inVoice = await io.in(ch.voice(roomId)).fetchSockets();
        // one voice tab per user: joining here takes their other tab out
        for (const other of inVoice) {
          if (other.data.userId !== user.id || other.id === socket.id) continue;
          other.emit('voice:ended', { roomId, reason: 'elsewhere' });
          other.leave(ch.voice(roomId));
        }
        const count = inVoice.filter((o) => o.data.userId !== user.id || o.id === socket.id).length;
        const already = inVoice.some((o) => o.id === socket.id);
        if (!already && count >= VOICE_MAX_PEERS)
          throw new AppError('LIMIT_REACHED', `Voice is full (${VOICE_MAX_PEERS} max)`);
        await socket.join(ch.voice(roomId));
        socket.data.voice = { roomId, muted: myVoice()?.muted ?? true };
      });
      const [peers, iceServers] = await Promise.all([voicePeers(roomId), d.ice.iceServers()]);
      void broadcastVoice(roomId);
      return { peerId: socket.id, peers: peers.filter((p) => p.peerId !== socket.id), iceServers };
    });

    on('voice:leave', VoiceLeaveSchema, 'durable', async ({ roomId }) => {
      if (myVoice()?.roomId === roomId) await leaveVoice();
    });

    on('voice:mute', VoiceMuteSchema, 'durable', async ({ roomId, muted }) => {
      const v = myVoice();
      if (v?.roomId !== roomId) throw new AppError('FORBIDDEN', 'Join voice first');
      if (v.muted === muted) return;
      socket.data.voice = { roomId, muted };
      await broadcastVoice(roomId);
    });

    // offers / answers / ICE go to one peer, only while both are in this room's channel and
    // the sender is still a member. Peer lookups are cached briefly (an ICE burst is ~10
    // signals per peer); a kick or leave removes the socket from the channel at once.
    let voiceMember: { roomId: string; until: number } | null = null;
    let peerCache: { roomId: string; ids: Set<string>; until: number } | null = null;
    async function signalTarget(roomId: string, to: string): Promise<boolean> {
      if (myVoice()?.roomId !== roomId || to === socket.id) return false;
      const now = Date.now();
      if (!(voiceMember?.roomId === roomId && voiceMember.until > now)) {
        if (!can(await d.policy.roleOf(roomId, user.id), 'room.interact')) return false;
        voiceMember = { roomId, until: now + CURSOR_MEMBER_TTL_MS };
      }
      if (!(peerCache?.roomId === roomId && peerCache.until > now && peerCache.ids.has(to))) {
        const ids = new Set((await io.in(ch.voice(roomId)).fetchSockets()).map((s) => s.id));
        peerCache = { roomId, ids, until: now + 2_000 };
      }
      return peerCache.ids.has(to);
    }

    (socket.on as (ev: string, fn: (payload: unknown) => void) => void)(
      'voice:signal',
      (payload) => {
        if (!limiter.take('signal')) return;
        const parsed = VoiceSignalSchema.safeParse(payload);
        if (!parsed.success) return;
        const { roomId, to, data } = parsed.data;
        signalTarget(roomId, to)
          .then((ok) => {
            if (ok) io.to(to).emit('voice:signal', { roomId, from: socket.id, data });
          })
          .catch(() => undefined);
      },
    );

    // leaders this socket followed: their counts drop once it is gone
    let followed: string[] = [];
    socket.on('disconnecting', () => {
      followed = [...socket.rooms]
        .filter((r) => r.startsWith('follow:'))
        .map((r) => r.slice('follow:'.length));
    });

    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      // the adapter already dropped it from the voice room: tell the others
      if (socket.data.voice) void broadcastVoice(socket.data.voice.roomId);
      for (const leaderId of followed) void notifyFollowers(leaderId);
      for (const roomId of socket.data.rooms) {
        // fire-and-forget, but never an unhandled rejection (Redis gone → process crash)
        presence
          .leave(roomId, user.id, socket.id)
          .then(() => broadcastPresence(roomId))
          .catch((err: unknown) => {
            log.warn({ err, roomId }, 'presence leave on disconnect failed');
          });
      }
    });
  });

  // ---- REST → realtime bridge (ARCHITECTURE §8) -------------------------------------------
  /** Pull a user out of a room on every instance; optionally tell them and disconnect. */
  async function evict(roomId: string, userId: string, kicked: boolean) {
    const sockets = await io.in(ch.user(userId)).fetchSockets();
    for (const s of sockets) {
      if (!s.data.rooms.includes(roomId)) continue;
      if (kicked) {
        s.emit('member:kicked', { userId });
        s.disconnect(true);
      } else {
        s.leave(ch.voice(roomId));
        s.leave(ch.room(roomId));
        if (s.data.boardRoomId === roomId && s.data.boardId) s.leave(ch.board(s.data.boardId));
      }
    }
    await presence.removeUser(roomId, userId);
    await broadcastPresence(roomId);
    await broadcastVoice(roomId);
  }

  d.events.on('chat:message', ({ roomId, message }) =>
    io.to(ch.room(roomId)).emit('chat:message', { message }),
  );
  // after a committed restore: everyone on that board reloads it in full
  d.events.on('board:reset', ({ boardId, seq, reason, actorId }) =>
    io.to(ch.board(boardId)).emit('board:reset', { boardId, seq, reason, actorId }),
  );
  d.events.on('chat:deleted', ({ roomId, messageId }) =>
    io.to(ch.room(roomId)).emit('chat:deleted', { messageId }),
  );
  d.events.on('member:joined', ({ roomId, member }) =>
    io.to(ch.room(roomId)).emit('member:joined', { member }),
  );
  d.events.on('member:left', ({ roomId, userId }) => {
    io.to(ch.room(roomId)).emit('member:left', { userId });
    evict(roomId, userId, false).catch((err: unknown) => {
      log.warn({ err, roomId }, 'evict after leave failed');
    });
  });
  d.events.on('member:kicked', ({ roomId, userId }) => {
    io.to(ch.room(roomId)).emit('member:kicked', { userId });
    evict(roomId, userId, true).catch((err: unknown) => {
      log.warn({ err, roomId }, 'evict after kick failed');
    });
  });
  d.events.on('member:roleChanged', ({ roomId, userId, role }) =>
    io.to(ch.room(roomId)).emit('member:roleChanged', { userId, role }),
  );
  d.events.on('room:updated', ({ roomId, room }) =>
    io.to(ch.room(roomId)).emit('room:updated', { room }),
  );
  d.events.on('room:deleted', ({ roomId }) => {
    io.to(ch.room(roomId)).emit('room:deleted', { roomId });
    io.in(ch.room(roomId)).socketsLeave(ch.room(roomId));
  });
  d.events.on('board:created', ({ roomId, board }) =>
    io.to(ch.room(roomId)).emit('board:created', { board }),
  );
  d.events.on('board:updated', ({ roomId, board }) =>
    io.to(ch.room(roomId)).emit('board:updated', { board }),
  );
  d.events.on('board:deleted', ({ roomId, boardId }) => {
    io.to(ch.room(roomId)).emit('board:deleted', { boardId });
    io.in(ch.board(boardId)).socketsLeave(ch.board(boardId));
  });

  return {
    io,
    presence,
    /** logout / logout-all / password change / theft: drop those sessions' sockets everywhere */
    async close() {
      closing = true;
      clearInterval(cursorTimer);
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => {
        io.engine.close();
        resolve();
      });
      // quit, not disconnect: disconnectSockets just published through the adapter, and a
      // hard disconnect rejects that pending reply ("Connection is closed", unhandled)
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}

/** Disconnects every socket of the given sessions on every instance (via the Redis adapter). */
export function disconnectSessions(io: RealtimeServer, sids: string[]) {
  if (sids.length > 0) io.in(sids.map(ch.session)).disconnectSockets(true);
}
