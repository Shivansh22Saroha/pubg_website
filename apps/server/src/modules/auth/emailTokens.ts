import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { EMAIL_TOKEN_TTL_MS, type EmailTokenPurpose } from '@rotationlab/shared';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

/** Same answer for unknown, used, expired and wrong-purpose tokens — no oracle. */
export const INVALID_LINK = 'This link is invalid or has expired';

export function hashEmailToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Email verification / reset tokens (SECURITY A9): 256-bit random, base64url, only the
 * SHA-256 stored, single use, 24 h (verify) / 30 min (reset). Issuing a new token voids the
 * user's earlier unused ones of that purpose. Consuming is one conditional UPDATE, so two
 * concurrent uses can't both succeed.
 */
export function createEmailTokens(prisma: PrismaClient, now: () => Date = () => new Date()) {
  return {
    async issue(userId: string, purpose: EmailTokenPurpose): Promise<string> {
      const raw = randomBytes(32).toString('base64url');
      const at = now();
      await prisma.$transaction([
        prisma.emailToken.updateMany({
          where: { userId, purpose, usedAt: null },
          data: { usedAt: at },
        }),
        prisma.emailToken.create({
          data: {
            id: newId(),
            userId,
            purpose,
            tokenHash: hashEmailToken(raw),
            expiresAt: new Date(at.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
          },
        }),
      ]);
      return raw;
    },

    /** Marks the token used and returns its user, or throws BAD_REQUEST "invalid or expired". */
    async consume(raw: string, purpose: EmailTokenPurpose): Promise<string> {
      const tokenHash = hashEmailToken(raw);
      const at = now();
      const { count } = await prisma.emailToken.updateMany({
        where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: at } },
        data: { usedAt: at },
      });
      if (count !== 1) throw new AppError('BAD_REQUEST', INVALID_LINK);
      const row = await prisma.emailToken.findUniqueOrThrow({
        where: { tokenHash },
        select: { userId: true },
      });
      return row.userId;
    },
  };
}

export type EmailTokens = ReturnType<typeof createEmailTokens>;
