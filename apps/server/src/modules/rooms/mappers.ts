import type {
  Board as BoardRow,
  Layer as LayerRow,
  MapId as MapIdRow,
  RoomInvite,
  RoomMember,
  User,
} from '@prisma/client';
import type { Board, Invite, Layer, MapId, Member, PublicUser } from '@rotationlab/shared';

/** DB enum (ERANGEL) ↔ API id (erangel). */
export const toMapId = (m: MapIdRow): MapId => m.toLowerCase() as MapId;
export const fromMapId = (m: MapId): MapIdRow => m.toUpperCase() as MapIdRow;

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    ign: u.ign,
    avatarColor: u.avatarColor,
  };
}

export function toMember(m: RoomMember & { user: User }, online = false): Member {
  return { user: toPublicUser(m.user), role: m.role, joinedAt: m.joinedAt.toISOString(), online };
}

export function toBoard(b: BoardRow): Board {
  return {
    id: b.id,
    roomId: b.roomId,
    name: b.name,
    mapId: toMapId(b.mapId),
    position: b.position,
    elementCount: b.elementCount,
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function toLayer(l: LayerRow): Layer {
  return {
    id: l.id,
    boardId: l.boardId,
    name: l.name,
    color: l.color,
    position: l.position,
    visible: l.visible,
    locked: l.locked,
    seq: Number(l.seq),
  };
}

export function toInvite(i: RoomInvite, appOrigin: string): Invite {
  return {
    id: i.id,
    code: i.code,
    url: `${appOrigin}/join/${i.code}`,
    role: i.role === 'OWNER' ? 'EDITOR' : i.role, // CHECK forbids OWNER; narrows the type
    maxUses: i.maxUses,
    useCount: i.useCount,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}
