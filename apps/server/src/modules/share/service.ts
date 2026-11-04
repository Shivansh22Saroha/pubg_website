import type { PrismaClient, ShareLink as ShareLinkRow } from '@prisma/client';
import {
  SHARE_TOKEN_BYTES,
  shareUrl,
  type ShareExpiry,
  type ShareLink,
  type ShareLinkCreatedResponse,
  type SharedBoardResponse,
} from '@rotationlab/shared';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import { toPublicElement } from '../elements/service.js';
import { toBoard, toLayer } from '../rooms/mappers.js';
import type { RoomPolicy } from '../rooms/policy.js';

const DAY = 86_400_000;
export const SHARE_EXPIRY_MS: Record<ShareExpiry, number | null> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  never: null,
};

/** One answer for unknown, revoked, regenerated-away and expired tokens — nothing to probe. */
const GONE = () => new AppError('NOT_FOUND', 'This link is invalid or has expired');

const toShareLink = (row: ShareLinkRow): ShareLink => ({
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt?.toISOString() ?? null,
});

/**
 * Public read-only board links (Phase 11, FEATURES F4b). Managing a link needs `board.share`
 * (owner / editor) through the room policy, so non-members get 404. The public read takes
 * only a token: it is hashed and looked up, and the answer is the board as it is now, without
 * the room id, author ids or anything else that names a member.
 */
export function createShareService({
  prisma,
  policy,
  appOrigin,
}: {
  prisma: PrismaClient;
  policy: RoomPolicy;
  appOrigin: string;
}) {
  return {
    async status(user: AuthUser, boardId: string): Promise<ShareLink | null> {
      await policy.requireBoard(user, boardId, 'board.share');
      const row = await prisma.shareLink.findUnique({ where: { boardId } });
      return row ? toShareLink(row) : null;
    },

    /** Create, or regenerate (a new token replaces the old one, which stops working at once). */
    async create(
      user: AuthUser,
      boardId: string,
      expiresIn: ShareExpiry,
    ): Promise<ShareLinkCreatedResponse> {
      const { board } = await policy.requireBoard(user, boardId, 'board.share');
      const token = randomToken(SHARE_TOKEN_BYTES);
      const ms = SHARE_EXPIRY_MS[expiresIn];
      const data = {
        tokenHash: sha256Hex(token),
        createdBy: user.id,
        createdAt: new Date(),
        expiresAt: ms === null ? null : new Date(Date.now() + ms),
      };
      const row = await prisma.$transaction(async (tx) => {
        const existing = await tx.shareLink.findUnique({ where: { boardId } });
        const saved = await tx.shareLink.upsert({
          where: { boardId },
          create: { id: newId(), boardId, ...data },
          update: data,
        });
        await tx.auditLog.create({
          data: {
            id: newId(),
            actorId: user.id,
            roomId: board.roomId,
            action: existing ? 'share.regenerate' : 'share.create',
            targetId: boardId,
            meta: { expiresIn },
          },
        });
        return saved;
      });
      return { share: toShareLink(row), url: shareUrl(appOrigin, token) };
    },

    /** Idempotent: revoking a board without a link is a no-op. */
    async revoke(user: AuthUser, boardId: string): Promise<void> {
      const { board } = await policy.requireBoard(user, boardId, 'board.share');
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.shareLink.deleteMany({ where: { boardId } });
        if (count > 0) {
          await tx.auditLog.create({
            data: {
              id: newId(),
              actorId: user.id,
              roomId: board.roomId,
              action: 'share.revoke',
              targetId: boardId,
              meta: {},
            },
          });
        }
      });
    },

    /** `GET /public/share/:token` — no auth. */
    async read(token: string): Promise<SharedBoardResponse> {
      const row = await prisma.shareLink.findUnique({
        where: { tokenHash: sha256Hex(token) },
        include: {
          board: {
            include: {
              room: { select: { deletedAt: true } },
              layers: { orderBy: { position: 'asc' } },
              elements: { orderBy: [{ z: 'asc' }, { seq: 'asc' }] },
            },
          },
        },
      });
      if (!row || row.board.room.deletedAt) throw GONE();
      if (row.expiresAt && row.expiresAt <= new Date()) throw GONE();
      const { roomId: _roomId, ...board } = toBoard(row.board);
      return {
        board,
        layers: row.board.layers.map(toLayer),
        elements: row.board.elements.map(toPublicElement),
        expiresAt: row.expiresAt?.toISOString() ?? null,
      };
    },
  };
}
export type ShareService = ReturnType<typeof createShareService>;
