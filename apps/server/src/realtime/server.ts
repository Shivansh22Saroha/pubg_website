import { createAdapter } from '@socket.io/redis-adapter';
import {
  BoardSubscribeSchema,
  can,
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
  REALTIME_PATH,
  RoomJoinSchema,
  RoomLeaveSchema,
  StrokePreviewSchema,
  SummonSchema,
  ViewUpdateSchema,
  type AckResult,
  type BoardOp,
  type ClientToServerEvents,
  type ErrorCode,
  type ServerToClientEvents,
} from '@rotationlab/shared';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { AuthUser } from '../lib/policy.js';
import type { RevocationList } from '../modules/auth/revocation.js';
import type { TokenService } from '../modules/auth/tokens.js';
import type { BoardOpsService, OpRequest } from '../modules/elements/service.js';
import type { RoomEvents } from '../modules/rooms/events.js';
import type { RoomPolicy } from '../modules/rooms/policy.js';
import type { RoomService } from '../modules/rooms/service.js';
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
] as const;
export const VOLATILE_EVENTS = [
  'cursor:move',
  'stroke:preview',
  'laser:point',
  'view:update',
] as const;

/** Serialisable per-socket state (RemoteSocket.data survives fetchSockets across instances). */
export interface SocketData {
  userId: string;
  sid: string;
  rooms: string[];
  boardId: string | null;
  boardRoomId: string | null;
  /** access token expiry, epoch seconds */
  exp: number;
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
  revocations: RevocationList;
  policy: RoomPolicy;
  rooms: RoomService;
  boardOps: BoardOpsService;
  events: RoomEvents;
  /** disconnect this long after the access token's exp (sessions never outlive their token) */
  tokenGraceSec: number;
}

const ch = {
  room: (id: string) => `room:${id}`,
  board: (id: string) => `board:${id}`,
  user: (id: string) => `user:${id}`,
  session: (sid: string) => `session:${sid}`,
  followers: (userId: string) => `follow:${userId}`,
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

  // ---- handshake (API_SPEC §7.1, SECURITY T2) ------------------------------------------
  io.use((socket, next) => {
    void (async () => {
      if (socket.handshake.headers.origin !== d.appOrigin) {
        next(connectError('FORBIDDEN', 'Origin not allowed'));
        return;
      }
      const token = d.app.parseCookie(socket.handshake.headers.cookie ?? '')[d.accessCookieName];
      if (!token) {
        next(connectError('UNAUTHENTICATED', 'Log in to continue'));
        return;
      }
      try {
        const claims = await d.tokens.verify(token);
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

  // ---- presence broadcast ---------------------------------------------------------------
  /** Never rejects (it is often fire-and-forget): a Redis failure is logged, not thrown. */
  async function broadcastPresence(roomId: string) {
    try {
      io.to(ch.room(roomId)).emit('presence:update', {
        roomId,
        users: await presence.list(roomId),
      });
    } catch (err) {
      log.warn({ err, roomId }, 'presence broadcast failed');
    }
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

    async function applyOps(boardId: string, ops: OpRequest[]) {
      const { board } = await d.policy.requireBoard(user, boardId, 'board.edit');
      requireJoined(board.roomId);
      const result = await d.boardOps.apply(user, boardId, ops);
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
      const onlineIds = new Set(online.map((p) => p.userId));
      return {
        room: { ...detail.room, onlineCount: onlineIds.size },
        members: detail.members.map((m) => ({ ...m, online: onlineIds.has(m.user.id) })),
        presence: online,
        boards: detail.boards,
      };
    });

    async function leaveRoom(roomId: string) {
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
    });

    on('follow:stop', FollowSchema, 'durable', async ({ targetUserId }) => {
      await socket.leave(ch.followers(targetUserId));
    });

    on('summon', SummonSchema, 'durable', async ({ boardId }) => {
      const { board, role } = await d.policy.requireBoard(user, boardId, 'room.view');
      requireJoined(board.roomId);
      if (!can(role, 'board.edit'))
        throw new AppError('FORBIDDEN', 'Only owners and editors can summon');
      socket.to(ch.room(board.roomId)).emit('summon', { userId: user.id, boardId });
    });

    // ---- ephemeral (volatile, never persisted) ---------------------------------------------
    onVolatile('cursor:move', CursorMoveSchema, async (p) => {
      if (await subscribedBoard(p.boardId))
        socket.volatile.to(ch.board(p.boardId)).emit('cursor:move', { userId: user.id, ...p });
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

    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
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
        s.leave(ch.room(roomId));
        if (s.data.boardRoomId === roomId && s.data.boardId) s.leave(ch.board(s.data.boardId));
      }
    }
    await presence.removeUser(roomId, userId);
    await broadcastPresence(roomId);
  }

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
