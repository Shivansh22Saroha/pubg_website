import { z } from 'zod';
import { ErrorCodeSchema, type ErrorCode } from './errors.js';
import type { RoomRoleSchema } from './permissions.js';
import {
  ELEMENT_LIMITS,
  ElementInputSchema,
  ElementSchema,
  LayerInputSchema,
  PtSchema,
  StyleSchema,
} from './schemas/elements.js';
import { ChatBodySchema, PingInputSchema, type ChatMessage } from './schemas/chat.js';
import { BoardSchema, LayerSchema, MemberSchema, RoomDetailSchema } from './schemas/rooms.js';

/**
 * Socket.IO contract (API_SPEC §7). Path `/realtime`, websocket transport. Every
 * client→server event except the volatile ones takes an ack callback.
 */
export const REALTIME_PATH = '/realtime';
/** `cursor:batch` cadence: 20 Hz, the most a client sends (RT-2) */
export const CURSOR_FLUSH_MS = 50;

// ---- acks ------------------------------------------------------------------------------

export type AckOk<T> = T extends undefined ? { ok: true } : { ok: true; data: T };
export type AckErr = { ok: false; code: ErrorCode; message: string };
export type AckResult<T> = AckOk<T> | AckErr;
export type Ack<T = undefined> = (res: AckResult<T>) => void;

export const AckErrSchema = z.object({
  ok: z.literal(false),
  code: ErrorCodeSchema,
  message: z.string(),
});

// ---- presence ----------------------------------------------------------------------------

/** 12 presence colours (UI_UX_SPEC §2.2) — distinct from the drawing palette order. */
export const PRESENCE_COLORS = [
  '#F2A900',
  '#38BDF8',
  '#22C55E',
  '#EC4899',
  '#A78BFA',
  '#F97316',
  '#14B8A6',
  '#FACC15',
  '#60A5FA',
  '#F43F5E',
  '#84CC16',
  '#E879F9',
] as const;

export const PresenceSchema = z.object({
  userId: z.uuid(),
  boardId: z.uuid().nullable(),
  idle: z.boolean(),
  color: z.string(),
});
export type Presence = z.infer<typeof PresenceSchema>;

// ---- board ops (durable) --------------------------------------------------------------------

export const OP_KINDS = [
  'element:upsert',
  'element:delete',
  'layer:upsert',
  'layer:delete',
  'layer:reorder',
  'layer:clear',
] as const;
export type OpKind = (typeof OP_KINDS)[number];

export const OpBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('element:upsert'), element: ElementSchema }),
  z.object({ kind: z.literal('element:delete'), elementId: z.uuid() }),
  z.object({ kind: z.literal('layer:upsert'), layer: LayerSchema }),
  z.object({ kind: z.literal('layer:delete'), layerId: z.uuid() }),
  z.object({ kind: z.literal('layer:reorder'), order: z.array(z.uuid()) }),
  z.object({ kind: z.literal('layer:clear'), layerId: z.uuid() }),
]);
export type OpBody = z.infer<typeof OpBodySchema>;

/** `board:op` broadcast and the entries of a delta resync. */
export const BoardOpSchema = z.object({
  boardId: z.uuid(),
  seq: z.number().int(),
  actorId: z.uuid().nullable(),
  opId: z.uuid(),
  op: OpBodySchema,
});
export type BoardOp = z.infer<typeof BoardOpSchema>;

// ---- client → server payloads ---------------------------------------------------------------

const opId = z.uuid();
const boardId = z.uuid();

export const RoomJoinSchema = z.strictObject({ roomId: z.uuid() });
export const RoomLeaveSchema = RoomJoinSchema;
export const BoardSubscribeSchema = z.strictObject({
  boardId,
  sinceSeq: z.number().int().min(0).optional(),
});

export const ElementUpsertSchema = z.strictObject({ opId, boardId, element: ElementInputSchema });
export const ElementDeleteSchema = z.strictObject({ opId, boardId, elementId: z.uuid() });
export const BatchOpSchema = z.discriminatedUnion('kind', [
  z.strictObject({ opId, kind: z.literal('upsert'), element: ElementInputSchema }),
  z.strictObject({ opId, kind: z.literal('delete'), elementId: z.uuid() }),
]);
export type BatchOp = z.output<typeof BatchOpSchema>;
export const ElementBatchSchema = z.strictObject({
  boardId,
  ops: z.array(BatchOpSchema).min(1).max(ELEMENT_LIMITS.batchOps),
});

export const LayerUpsertSchema = z.strictObject({ opId, boardId, layer: LayerInputSchema });
export const LayerDeleteSchema = z.strictObject({ opId, boardId, layerId: z.uuid() });
export const LayerReorderSchema = z.strictObject({
  opId,
  boardId,
  order: z.array(z.uuid()).min(1).max(10),
});
export const LayerClearSchema = LayerDeleteSchema;

export const ChatSendSchema = z.strictObject({
  /** idempotency key: a resend with the same clientId returns the stored message */
  clientId: z.uuid(),
  roomId: z.uuid(),
  body: ChatBodySchema,
  ping: PingInputSchema.optional(),
});
export const ChatTypingSchema = z.strictObject({ roomId: z.uuid() });

export const CursorMoveSchema = z.strictObject({
  boardId,
  x: z.number().int(),
  y: z.number().int(),
});
export const StrokePreviewSchema = z.strictObject({
  boardId,
  tempId: z.uuid(),
  points: z.array(PtSchema).min(1).max(200), // only the new points since the last preview
  style: StyleSchema,
});
export const LaserPointSchema = CursorMoveSchema;
export const ViewUpdateSchema = z.strictObject({
  boardId,
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number().min(-3).max(12),
});
export const FollowSchema = z.strictObject({ targetUserId: z.uuid() });
export const SummonSchema = z.strictObject({ boardId });
export const PresenceHeartbeatSchema = z.strictObject({
  roomId: z.uuid(),
  boardId: z.uuid().nullable(),
  idle: z.boolean(),
});

type In<S extends z.ZodType> = z.input<S>;

// ---- ack payloads ---------------------------------------------------------------------------

export const RoomJoinAckSchema = z.object({
  room: RoomDetailSchema,
  members: z.array(MemberSchema),
  presence: z.array(PresenceSchema),
  boards: z.array(BoardSchema),
});
export type RoomJoinAck = z.infer<typeof RoomJoinAckSchema>;

export const BoardSubscribeAckSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('delta'), ops: z.array(BoardOpSchema), seq: z.number().int() }),
  z.object({
    mode: z.literal('full'),
    layers: z.array(LayerSchema),
    elements: z.array(ElementSchema),
    seq: z.number().int(),
  }),
]);
export type BoardSubscribeAck = z.infer<typeof BoardSubscribeAckSchema>;

// ---- event maps (used by both io() and new Server()) ----------------------------------------

export interface ClientToServerEvents {
  'room:join': (p: In<typeof RoomJoinSchema>, ack: Ack<RoomJoinAck>) => void;
  'room:leave': (p: In<typeof RoomLeaveSchema>, ack: Ack) => void;
  'board:subscribe': (p: In<typeof BoardSubscribeSchema>, ack: Ack<BoardSubscribeAck>) => void;
  'element:upsert': (p: In<typeof ElementUpsertSchema>, ack: Ack<{ seq: number }>) => void;
  'element:delete': (p: In<typeof ElementDeleteSchema>, ack: Ack<{ seq: number }>) => void;
  'element:batch': (p: In<typeof ElementBatchSchema>, ack: Ack<{ seqs: number[] }>) => void;
  'layer:upsert': (p: In<typeof LayerUpsertSchema>, ack: Ack<{ seq: number }>) => void;
  'layer:delete': (p: In<typeof LayerDeleteSchema>, ack: Ack<{ seq: number }>) => void;
  'layer:reorder': (p: In<typeof LayerReorderSchema>, ack: Ack<{ seq: number }>) => void;
  'layer:clear': (p: In<typeof LayerClearSchema>, ack: Ack<{ seq: number }>) => void;
  'presence:heartbeat': (p: In<typeof PresenceHeartbeatSchema>, ack?: Ack) => void;
  'follow:start': (p: In<typeof FollowSchema>, ack: Ack) => void;
  'follow:stop': (p: In<typeof FollowSchema>, ack: Ack) => void;
  summon: (p: In<typeof SummonSchema>, ack: Ack) => void;
  // volatile — no ack, excess dropped silently
  'cursor:move': (p: In<typeof CursorMoveSchema>) => void;
  'stroke:preview': (p: In<typeof StrokePreviewSchema>) => void;
  'laser:point': (p: In<typeof LaserPointSchema>) => void;
  'view:update': (p: In<typeof ViewUpdateSchema>) => void;
  'chat:send': (p: In<typeof ChatSendSchema>, ack: Ack<{ message: ChatMessage }>) => void;
  /** volatile, no ack: relayed to the rest of the room ≤ 1 / 2 s per socket (Phase 11) */
  'chat:typing': (p: In<typeof ChatTypingSchema>) => void;
}

export interface ServerToClientEvents {
  /** on connect: when this socket's access token expires (epoch ms) — refresh ~60 s before */
  session: (p: { expiresAt: number }) => void;
  'board:op': (p: BoardOp) => void;
  'board:reset': (p: {
    boardId: string;
    seq: number;
    reason: 'snapshot_restore' | 'clear';
    /** who caused it (the restorer) */
    actorId: string | null;
  }) => void;
  'op:reject': (p: { opId: string; code: ErrorCode; message: string }) => void;
  'board:created': (p: { board: z.infer<typeof BoardSchema> }) => void;
  'board:updated': (p: { board: z.infer<typeof BoardSchema> }) => void;
  'board:deleted': (p: { boardId: string }) => void;
  'presence:update': (p: { roomId: string; users: Presence[] }) => void;
  /**
   * Live cursors (Phase 10): every CURSOR_FLUSH_MS the server sends each board the latest
   * position of every cursor that moved since the last flush — one message per recipient per
   * tick instead of one per teammate per move. Includes the recipient's own cursor (ignore it).
   */
  'cursor:batch': (p: {
    boardId: string;
    cursors: { userId: string; x: number; y: number }[];
  }) => void;
  'stroke:preview': (p: { userId: string } & z.infer<typeof StrokePreviewSchema>) => void;
  'laser:point': (p: { userId: string; boardId: string; x: number; y: number }) => void;
  'view:update': (p: { userId: string } & z.infer<typeof ViewUpdateSchema>) => void;
  summon: (p: { userId: string; boardId: string }) => void;
  /** to a leader: how many sockets follow them now (send `view:update` only while > 0) */
  'followers:update': (p: { count: number }) => void;
  'member:joined': (p: { member: z.infer<typeof MemberSchema> }) => void;
  'member:left': (p: { userId: string }) => void;
  'member:roleChanged': (p: { userId: string; role: z.infer<typeof RoomRoleSchema> }) => void;
  'member:kicked': (p: { userId: string }) => void;
  'room:updated': (p: { room: z.infer<typeof RoomDetailSchema> }) => void;
  'room:deleted': (p: { roomId: string }) => void;
  'chat:message': (p: { message: ChatMessage }) => void;
  'chat:deleted': (p: { messageId: string }) => void;
  'chat:typing': (p: { userId: string }) => void;
  error: (p: { code: ErrorCode; message: string }) => void;
}

/** Handshake failure codes (`connect_error` → `err.data.code`). */
export const CONNECT_ERROR_CODES = [
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN', // bad Origin
  'LIMIT_REACHED', // > 5 sockets per user
] as const;
