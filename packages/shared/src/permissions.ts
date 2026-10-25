import { z } from 'zod';

export const ROOM_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export const RoomRoleSchema = z.enum(ROOM_ROLES);
export type RoomRole = z.infer<typeof RoomRoleSchema>;

/** Roles that can be granted by an invite or a role change (never OWNER). */
export const AssignableRoleSchema = z.enum(['EDITOR', 'VIEWER']);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

const RANK: Record<RoomRole, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

export function roleAtLeast(role: RoomRole, min: RoomRole): boolean {
  return RANK[role] >= RANK[min];
}

/** The lower of two roles. */
export function minRole<R extends RoomRole>(a: R, b: RoomRole): R | RoomRole {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * Permission matrix — single source of truth (SECURITY §3, Z3). Server policy and UI both read
 * it; the authz-matrix test checks every route against it.
 */
export const PERMISSIONS = {
  /** view boards, chat, presence; list members and boards */
  'room.view': ['OWNER', 'EDITOR', 'VIEWER'],
  /** send chat, pings, laser, cursor */
  'room.interact': ['OWNER', 'EDITOR', 'VIEWER'],
  /** create/edit/delete elements; create/rename/recolor/reorder/delete *unlocked* layers */
  'board.edit': ['OWNER', 'EDITOR'],
  /** lock/unlock layers, and rename/recolor/delete a locked layer */
  'layer.lock': ['OWNER'],
  /** create/rename/duplicate/reorder boards, snapshots, restore */
  'board.manage': ['OWNER', 'EDITOR'],
  'board.delete': ['OWNER'],
  /** create invites (with role ≤ the creator's own) and list them */
  'invite.create': ['OWNER', 'EDITOR'],
  /** roles, kick, room settings, password, lock, transfer, delete room */
  'room.manage': ['OWNER'],
  /** delete any chat message (own messages: everyone) */
  'chat.deleteAny': ['OWNER'],
} as const satisfies Record<string, readonly RoomRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: RoomRole | null | undefined, permission: Permission): boolean {
  return role != null && (PERMISSIONS[permission] as readonly RoomRole[]).includes(role);
}
