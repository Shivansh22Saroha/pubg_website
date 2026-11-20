import type {
  Board as BoardRow,
  Layer as LayerRow,
  MapId as MapIdRow,
  RoomInvite,
  RoomMember,
  User,
} from '@prisma/client';
import type { Board, BoardMapId, Invite, Layer, Member, PublicUser } from '@rotationlab/shared';
import type { AssetStorage } from '../../lib/storage.js';

/** DB enum (ERANGEL, CUSTOM) ↔ API id (erangel, custom). */
export const toMapId = (m: MapIdRow): BoardMapId => m.toLowerCase() as BoardMapId;
export const fromMapId = (m: BoardMapId): MapIdRow => m.toUpperCase() as MapIdRow;

/**
 * Profile photos (F23) are private: every serialised user carries a signed URL for theirs. The
 * signer is the app's asset storage, set once by `buildApp` (`configureAvatarUrls`) so every
 * mapper below — rooms, chat, snapshots, /me — can sign without each service taking storage.
 * Unconfigured (unit tests): no URLs, initials everywhere.
 */
let signAvatar: ((key: string) => string) | null = null;
export function configureAvatarUrls(storage: Pick<AssetStorage, 'signedUrl'> | null): void {
  signAvatar = storage ? (key) => storage.signedUrl(key).url : null;
}
export function avatarUrlOf(key: string | null): string | null {
  if (!key || !signAvatar) return null;
  try {
    return signAvatar(key);
  } catch {
    return null; // a malformed stored key never breaks a response
  }
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    ign: u.ign,
    avatarColor: u.avatarColor,
    avatarUrl: avatarUrlOf(u.avatarKey),
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
    customMapId: b.customMapId,
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
