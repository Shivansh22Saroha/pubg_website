import type { PrismaClient } from '@prisma/client';
import { THUMBNAIL } from '@rotationlab/shared';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import { randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import type { AuthUser } from '../../lib/policy.js';
import type { AssetStorage } from '../../lib/storage.js';
import type { RoomPolicy } from '../rooms/policy.js';

const INVALID = () =>
  new AppError(
    'VALIDATION_ERROR',
    `Thumbnail must be a ${THUMBNAIL.size}×${THUMBNAIL.size} JPEG of at most ${THUMBNAIL.maxBytes / 1024} KB`,
  );

/**
 * Validates an uploaded thumbnail and re-encodes it, so what we store and serve is our own
 * JPEG (no EXIF / metadata, no smuggled payload): JPEG magic bytes, sharp's own decode with a
 * pixel cap, exactly 256×256, ≤ 100 KB.
 */
export async function reencodeThumbnail(body: Buffer): Promise<Buffer> {
  if (body.length === 0 || body.length > THUMBNAIL.maxBytes) throw INVALID();
  if (body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) throw INVALID();
  try {
    const img = sharp(body, { limitInputPixels: THUMBNAIL.size * THUMBNAIL.size, failOn: 'error' });
    const meta = await img.metadata();
    if (meta.format !== 'jpeg' || meta.width !== THUMBNAIL.size || meta.height !== THUMBNAIL.size)
      throw INVALID();
    const out = await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    if (out.length > THUMBNAIL.maxBytes) throw INVALID();
    return out;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw INVALID(); // sharp couldn't decode it
  }
}

/**
 * Board thumbnails (Phase 11, FEATURES F4): `board.edit` (owner / editor). Each upload gets a
 * fresh random key (`thumbnails/<boardId>/<128-bit>.jpg`), so a cached old image never shows
 * and a key can't be guessed from the board id; the previous object is deleted afterwards.
 */
export function createThumbnailService({
  prisma,
  policy,
  storage,
  log,
}: {
  prisma: PrismaClient;
  policy: RoomPolicy;
  storage: AssetStorage;
  log: FastifyBaseLogger;
}) {
  const removeQuietly = (key: string) => {
    storage.remove(key).catch((err: unknown) => {
      log.warn({ err, key }, 'thumbnail delete failed');
    });
  };

  return {
    async upload(user: AuthUser, boardId: string, body: Buffer): Promise<string> {
      await policy.requireBoard(user, boardId, 'board.edit');
      const jpeg = await reencodeThumbnail(body);
      const key = `thumbnails/${boardId}/${randomToken(16)}.jpg`;
      await storage.put(key, jpeg, 'image/jpeg');
      // swap the key under a row lock; raw SQL so boards.updated_at (tab order, "most recently
      // edited") doesn't move just because a picture was refreshed
      const previous = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ thumbnail_key: string | null }[]>`
          SELECT thumbnail_key FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
        if (rows.length === 0) return undefined;
        await tx.$executeRaw`UPDATE boards SET thumbnail_key = ${key} WHERE id = ${boardId}::uuid`;
        return rows[0]?.thumbnail_key ?? null;
      });
      if (previous === undefined) {
        removeQuietly(key); // the board was deleted meanwhile
        throw new AppError('NOT_FOUND', 'Board not found');
      }
      if (previous) removeQuietly(previous);
      return storage.url(key);
    },
  };
}
export type ThumbnailService = ReturnType<typeof createThumbnailService>;
