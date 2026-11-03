import { z } from 'zod';
import { MAP_IDS } from '../maps.js';
import { AssignableRoleSchema, RoomRoleSchema } from '../permissions.js';
import { HexColorSchema, textField } from '../text.js';
import { PublicUserSchema } from './auth.js';

// ---- limits (PRD §4, DATABASE_SCHEMA §3) ------------------------------------------------

export const ROOM_LIMITS = {
  nameMin: 3,
  nameMax: 40,
  descriptionMax: 280,
  passwordMin: 4,
  passwordMax: 128,
  boardNameMax: 40,
  layerNameMax: 32,
  maxBoards: 20,
  maxLayers: 10,
  inviteMaxUses: 100,
} as const;

/** Layers every new board starts with (FEATURES F2). */
export const DEFAULT_LAYERS = [
  { name: 'Plan', color: '#F2A900' },
  { name: 'Enemies', color: '#EF4444' },
  { name: 'Zones', color: '#F8FAFC' },
] as const;

export const MapIdSchema = z.enum(MAP_IDS);

/** Crockford base32 alphabet (no I, L, O, U). */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_CODE_LENGTH = 10;

/** Accepts "7kq2-m9xf-ap", "7KQ2 M9XF AP", and Crockford look-alikes (I/L→1, O→0). */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

/** "7KQ2M9XFAP" → "7KQ2-M9XF-AP" (UI_UX_SPEC §3.7). */
export function formatInviteCode(code: string): string {
  return code.replace(/^(.{4})(.{4})(.{2})$/, '$1-$2-$3');
}

export const InviteCodeSchema = z
  .string()
  .max(32)
  .transform(normalizeInviteCode)
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/, 'Invalid invite code'));

// ---- response objects (API_SPEC §1.5) ----------------------------------------------------

export const RoomSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  role: RoomRoleSchema,
  memberCount: z.number().int(),
  onlineCount: z.number().int(),
  boardCount: z.number().int(),
  lastActivityAt: z.iso.datetime(),
  thumbnailUrl: z.string().nullable(),
  hasPassword: z.boolean(),
  /** map of the most recently updated board (dashboard card preview) */
  primaryMapId: MapIdSchema,
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

export const RoomDetailSchema = RoomSummarySchema.extend({
  ownerId: z.uuid(),
  isLocked: z.boolean(),
  defaultRole: AssignableRoleSchema,
  maxMembers: z.number().int(),
});
export type RoomDetail = z.infer<typeof RoomDetailSchema>;

export const MemberSchema = z.object({
  user: PublicUserSchema,
  role: RoomRoleSchema,
  joinedAt: z.iso.datetime(),
  online: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const BoardSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  name: z.string(),
  mapId: MapIdSchema,
  position: z.number().int(),
  elementCount: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type Board = z.infer<typeof BoardSchema>;

export const LayerSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  color: HexColorSchema,
  position: z.number().int(),
  visible: z.boolean(),
  locked: z.boolean(),
  seq: z.number().int(),
});
export type Layer = z.infer<typeof LayerSchema>;

export const InviteSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  url: z.string(),
  role: AssignableRoleSchema,
  maxUses: z.number().int().nullable(),
  useCount: z.number().int(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const InvitePreviewSchema = z.object({
  room: z.object({
    name: z.string(),
    memberCount: z.number().int(),
    ownerName: z.string(),
    hasPassword: z.boolean(),
    maps: z.array(MapIdSchema),
  }),
  valid: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

// ---- envelopes ---------------------------------------------------------------------------

export const RoomListResponseSchema = z.object({ items: z.array(RoomSummarySchema) });
export const RoomDetailResponseSchema = z.object({
  room: RoomDetailSchema,
  members: z.array(MemberSchema),
  boards: z.array(BoardSchema),
});
export type RoomDetailResponse = z.infer<typeof RoomDetailResponseSchema>;
export const CreateRoomResponseSchema = z.object({ room: RoomSummarySchema, board: BoardSchema });
export const RoomResponseSchema = z.object({ room: RoomDetailSchema });
export const MembersResponseSchema = z.object({ items: z.array(MemberSchema) });
export const MemberResponseSchema = z.object({ member: MemberSchema });
export const InvitesResponseSchema = z.object({ items: z.array(InviteSchema) });
export const InviteResponseSchema = z.object({ invite: InviteSchema });
export const AcceptInviteResponseSchema = z.object({ roomId: z.uuid() });
export const BoardsResponseSchema = z.object({ items: z.array(BoardSchema) });
export const BoardResponseSchema = z.object({ board: BoardSchema });
export const BoardStateResponseSchema = z.object({
  board: BoardSchema,
  layers: z.array(LayerSchema),
  // Element shape arrives with the realtime core (Phase 5)
  elements: z.array(z.unknown()),
  seq: z.number().int(),
});
export type BoardState = z.infer<typeof BoardStateResponseSchema>;

// ---- request bodies & params -------------------------------------------------------------

export const RoomNameSchema = textField(ROOM_LIMITS.nameMin, ROOM_LIMITS.nameMax);
export const RoomDescriptionSchema = textField(0, ROOM_LIMITS.descriptionMax, {
  keepNewlines: true,
});
export const RoomPasswordSchema = z
  .string()
  .min(ROOM_LIMITS.passwordMin)
  .max(ROOM_LIMITS.passwordMax);
export const BoardNameSchema = textField(1, ROOM_LIMITS.boardNameMax);

export const CreateRoomBodySchema = z.strictObject({
  name: RoomNameSchema,
  description: RoomDescriptionSchema.nullable().optional(),
  password: RoomPasswordSchema.nullable().optional(),
  defaultRole: AssignableRoleSchema.optional(),
  firstBoard: z.strictObject({ name: BoardNameSchema, mapId: MapIdSchema }),
});
export type CreateRoomBody = z.input<typeof CreateRoomBodySchema>;

export const UpdateRoomBodySchema = z
  .strictObject({
    name: RoomNameSchema.optional(),
    description: RoomDescriptionSchema.nullable().optional(),
    defaultRole: AssignableRoleSchema.optional(),
    isLocked: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type UpdateRoomBody = z.input<typeof UpdateRoomBodySchema>;

export const SetRoomPasswordBodySchema = z.strictObject({
  password: RoomPasswordSchema.nullable(),
});
export const DeleteRoomBodySchema = z.strictObject({ confirmName: z.string().max(80) });
export const TransferRoomBodySchema = z.strictObject({
  userId: z.uuid(),
  password: z.string().min(1).max(512),
});
export const UpdateMemberBodySchema = z.strictObject({ role: AssignableRoleSchema });
/** DELETE /rooms/:roomId/members/:userId — optional body; `ban` also blocks rejoining. */
export const KickMemberBodySchema = z.strictObject({ ban: z.boolean().optional() }).nullish(); // Fastify passes null when no body is sent

export const RoomBanSchema = z.object({
  user: PublicUserSchema,
  bannedBy: PublicUserSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type RoomBan = z.infer<typeof RoomBanSchema>;
export const RoomBansResponseSchema = z.object({ items: z.array(RoomBanSchema) });

export const INVITE_EXPIRY = ['1h', '24h', '7d', 'never'] as const;
export const CreateInviteBodySchema = z.strictObject({
  expiresIn: z.enum(INVITE_EXPIRY),
  maxUses: z.number().int().min(1).max(ROOM_LIMITS.inviteMaxUses).optional(),
  role: AssignableRoleSchema.optional(),
});
export type CreateInviteBody = z.input<typeof CreateInviteBodySchema>;

export const AcceptInviteBodySchema = z.strictObject({
  password: z.string().max(ROOM_LIMITS.passwordMax).optional(),
});

export const CreateBoardBodySchema = z.strictObject({
  name: BoardNameSchema,
  mapId: MapIdSchema,
  duplicateFrom: z.uuid().optional(),
});
export type CreateBoardBody = z.input<typeof CreateBoardBodySchema>;

export const UpdateBoardBodySchema = z
  .strictObject({
    name: BoardNameSchema.optional(),
    position: z
      .number()
      .int()
      .min(0)
      .max(ROOM_LIMITS.maxBoards - 1)
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type UpdateBoardBody = z.input<typeof UpdateBoardBodySchema>;

export const RoomParamsSchema = z.strictObject({ roomId: z.uuid() });
export const RoomMemberParamsSchema = z.strictObject({ roomId: z.uuid(), userId: z.uuid() });
export const RoomInviteParamsSchema = z.strictObject({ roomId: z.uuid(), inviteId: z.uuid() });
export const BoardParamsSchema = z.strictObject({ boardId: z.uuid() });
export const InviteCodeParamsSchema = z.strictObject({ code: InviteCodeSchema });

// ---- board thumbnails (Phase 11) -----------------------------------------------------------

/** `PUT /boards/:boardId/thumbnail`: a 256×256 JPEG, ≤ 100 KB, re-encoded by the server. */
export const THUMBNAIL = { size: 256, maxBytes: 100 * 1024, quality: 0.8 } as const;
export const ThumbnailResponseSchema = z.object({ thumbnailUrl: z.string() });
/** local storage backend: `GET /api/v1/assets/thumbnails/:boardId/:file` */
export const AssetParamsSchema = z.strictObject({
  boardId: z.uuid(),
  file: z.string().regex(/^[A-Za-z0-9_-]{22}\.jpg$/),
});
