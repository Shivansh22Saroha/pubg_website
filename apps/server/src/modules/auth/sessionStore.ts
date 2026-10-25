import type { Prisma, PrismaClient } from '@prisma/client';
import type { RefreshTokenRecord, RefreshTokenStore, RefreshTokenTx } from './sessions.js';

type Db = PrismaClient | Prisma.TransactionClient;

function ops(db: Db) {
  return {
    create: async (token: Parameters<RefreshTokenTx['create']>[0]) => {
      await db.refreshToken.create({ data: token });
    },
    revokeFamily: async (familyId: string, at: Date) => {
      await db.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at },
      });
    },
  };
}

/** Prisma-backed refresh-token store. Rotation locks the presented row (SELECT … FOR UPDATE). */
export function createPrismaRefreshTokenStore(prisma: PrismaClient): RefreshTokenStore {
  const base = ops(prisma);
  return {
    ...base,

    transaction: (fn) =>
      prisma.$transaction(async (tx) => {
        const txOps = ops(tx);
        return fn({
          ...txOps,
          async findByHashForUpdate(tokenHash) {
            const rows = await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
            const id = rows[0]?.id;
            return id ? tx.refreshToken.findUnique({ where: { id } }) : null;
          },
          async markRotated(id, replacedBy, at) {
            await tx.refreshToken.update({ where: { id }, data: { replacedBy, revokedAt: at } });
          },
        });
      }),

    findByHash: (tokenHash) => prisma.refreshToken.findUnique({ where: { tokenHash } }),

    async revokeAllForUser(userId, at, exceptFamilyId) {
      const where: Prisma.RefreshTokenWhereInput = {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { NOT: { familyId: exceptFamilyId } } : {}),
      };
      const families = await prisma.refreshToken.findMany({
        where,
        select: { familyId: true },
        distinct: ['familyId'],
      });
      await prisma.refreshToken.updateMany({ where, data: { revokedAt: at } });
      return families.map((f) => f.familyId);
    },

    listLive: (userId, at): Promise<RefreshTokenRecord[]> =>
      prisma.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: at } },
        orderBy: { createdAt: 'desc' },
      }),

    async familyStarts(familyIds) {
      if (familyIds.length === 0) return new Map();
      const rows = await prisma.refreshToken.groupBy({
        by: ['familyId'],
        where: { familyId: { in: familyIds } },
        _min: { createdAt: true },
      });
      return new Map(rows.map((r) => [r.familyId, r._min.createdAt ?? new Date(0)]));
    },
  };
}
