import type { PrismaClient } from '@prisma/client';
import { AVATAR_LIMITS, type Me } from '@rotationlab/shared';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import { randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import type { AuthUser } from '../../lib/policy.js';
import type { AssetStorage } from '../../lib/storage.js';
import { toMe } from '../auth/service.js';
import { sniffImage } from '../customMaps/service.js';

/** decode cap: generous for a phone photo sent as-is by an old client */
const MAX_INPUT_PIXELS = 8_000 * 8_000;
const BACKGROUND = { r: 16, g: 20, b: 24, alpha: 1 };

const invalid = (why: string) => new AppError('VALIDATION_ERROR', why);

/**
 * Turns an upload into the stored photo (SECURITY F23, as F20 / V8): magic bytes checked,
 * decoded by sharp with a pixel cap, EXIF rotation applied, centre-cropped to a 256 px square,
 * transparency flattened and re-encoded as WebP — no metadata (location, camera) survives.
 */
export async function processAvatarImage(body: Buffer): Promise<Buffer> {
  if (body.length === 0) throw invalid('Send the photo as the request body');
  if (body.length > AVATAR_LIMITS.uploadMaxBytes) throw invalid('Photo is too large');
  const format = sniffImage(body);
  if (!format) throw invalid('Use a JPG, PNG or WebP image');
  try {
    const meta = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (meta.format !== format) throw invalid('Use a JPG, PNG or WebP image');
    if (Math.min(meta.width, meta.height) < AVATAR_LIMITS.minSidePx)
      throw invalid(`Photo must be at least ${AVATAR_LIMITS.minSidePx} px on each side`);
    return await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_LIMITS.sizePx, AVATAR_LIMITS.sizePx, { fit: 'cover', position: 'centre' })
      .flatten({ background: BACKGROUND })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw invalid('Couldn’t read that image — try another file');
  }
}

/**
 * Profile photos (FEATURES F23): a user sets or removes their own (`requireUser` is the whole
 * policy — nobody can touch another user's photo). Each upload gets a fresh random key under
 * `avatars/<userId>/`, so a URL never shows an older photo; the previous file is deleted.
 */
export function createAvatarService({
  prisma,
  storage,
  log,
}: {
  prisma: PrismaClient;
  storage: AssetStorage;
  log: FastifyBaseLogger;
}) {
  const removeQuietly = (key: string | null) => {
    if (!key) return;
    storage.remove(key).catch((err: unknown) => {
      log.warn({ err, key }, 'avatar file delete failed');
    });
  };

  async function activeUser(id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || u.deletedAt) throw new AppError('UNAUTHENTICATED', 'Log in to continue');
    return u;
  }

  return {
    async set(user: AuthUser, body: Buffer): Promise<Me> {
      const before = await activeUser(user.id);
      const image = await processAvatarImage(body);
      const key = `avatars/${user.id}/${randomToken(16).slice(0, 22)}.webp`;
      await storage.put(key, image, 'image/webp');
      try {
        const updated = await prisma.user.update({
          where: { id: user.id, deletedAt: null },
          data: { avatarKey: key },
        });
        if (before.avatarKey !== key) removeQuietly(before.avatarKey);
        return toMe(updated);
      } catch (err) {
        removeQuietly(key);
        throw err;
      }
    },

    async remove(user: AuthUser): Promise<Me> {
      const before = await activeUser(user.id);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { avatarKey: null },
      });
      removeQuietly(before.avatarKey);
      return toMe(updated);
    },
  };
}

export type AvatarService = ReturnType<typeof createAvatarService>;
