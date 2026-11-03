import type { PrismaClient } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;
/** ARCHITECTURE §11: soft-deleted rooms are hard-deleted after 7 days */
export const PURGE_ROOMS_AFTER_MS = 7 * DAY_MS;
/** expired / revoked refresh tokens (and spent email tokens) are kept 30 days for forensics */
export const TOKEN_RETENTION_MS = 30 * DAY_MS;
/** DATABASE_SCHEMA §3.13: audit log retention */
export const AUDIT_RETENTION_MS = 90 * DAY_MS;

/**
 * Hard-deletes rooms soft-deleted more than 7 days ago. Boards, layers, elements, ops,
 * snapshots, members, invites, bans and chat go with them (ON DELETE CASCADE).
 */
export async function purgeDeletedRooms(prisma: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await prisma.room.deleteMany({
    where: { deletedAt: { lt: new Date(now.getTime() - PURGE_ROOMS_AFTER_MS) } },
  });
  return count;
}

/** Marks invites past their expiry as revoked (the accept path checks expiry anyway). */
export async function expireInvites(prisma: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await prisma.roomInvite.updateMany({
    where: { revokedAt: null, expiresAt: { lt: now } },
    data: { revokedAt: now },
  });
  return count;
}

/** Deletes share links past their expiry (Phase 11; the public read checks expiry anyway). */
export async function expireShareLinks(prisma: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await prisma.shareLink.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

/** Deletes refresh tokens expired or revoked > 30 days ago, used / expired email tokens, old audit rows. */
export async function cleanupTokens(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ refresh: number; email: number; audit: number }> {
  const cutoff = new Date(now.getTime() - TOKEN_RETENTION_MS);
  // rotation links point at newer rows; clear them first so deleting a chain never trips the FK
  const old = { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] };
  await prisma.refreshToken.updateMany({ where: old, data: { replacedBy: null } });
  const refresh = await prisma.refreshToken.deleteMany({ where: old });
  const email = await prisma.emailToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
  });
  const audit = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - AUDIT_RETENTION_MS) } },
  });
  return { refresh: refresh.count, email: email.count, audit: audit.count };
}
