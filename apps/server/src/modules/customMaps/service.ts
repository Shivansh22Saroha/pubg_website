import type { CustomMap as CustomMapRow, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { CUSTOM_MAP_LIMITS, type CustomMap, type PublicCustomMap } from '@rotationlab/shared';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import { randomToken } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AuthUser } from '../../lib/policy.js';
import type { AssetStorage } from '../../lib/storage.js';
import type { RoomEvents } from '../rooms/events.js';
import type { RoomPolicy } from '../rooms/policy.js';

/** what the room members' map is padded with (outside the uploaded image) */
const PAD_COLOR = { r: 16, g: 20, b: 24, alpha: 1 };
/** decode cap: a little over 4096² so a slightly larger upload is shrunk, not refused */
const MAX_INPUT_PIXELS = 6_000 * 6_000;

type ImageFormat = 'jpeg' | 'png' | 'webp';

/** magic bytes, so the declared content type can't smuggle anything else in */
export function sniffImage(buf: Buffer): ImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  return null;
}

const invalid = (why: string) => new AppError('VALIDATION_ERROR', why);

/**
 * Turns an upload into what we store (SECURITY F20 / V8): magic bytes checked, decoded by sharp
 * with a pixel cap, EXIF rotation applied, shrunk to ≤ 4096 px, padded to a centred square and
 * re-encoded as WebP (no metadata survives), plus a 512 px preview.
 */
export async function processMapImage(
  body: Buffer,
): Promise<{ image: Buffer; preview: Buffer; sizePx: number }> {
  if (body.length === 0) throw invalid('Send the map image as the request body');
  if (body.length > CUSTOM_MAP_LIMITS.uploadMaxBytes) throw invalid('Image is too large');
  const format = sniffImage(body);
  if (!format) throw invalid('Use a JPG, PNG or WebP image');
  try {
    const meta = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (meta.format !== format) throw invalid('Use a JPG, PNG or WebP image');
    // EXIF orientation 5–8 swaps width and height
    const swap = (meta.orientation ?? 1) >= 5;
    const w = swap ? meta.height : meta.width;
    const h = swap ? meta.width : meta.height;
    if (Math.max(w, h) < CUSTOM_MAP_LIMITS.minSidePx)
      throw invalid(`Image must be at least ${CUSTOM_MAP_LIMITS.minSidePx} px on its longer side`);
    const fit = Math.min(1, CUSTOM_MAP_LIMITS.maxSidePx / Math.max(w, h));
    const rw = Math.max(1, Math.round(w * fit));
    const rh = Math.max(1, Math.round(h * fit));
    const side = Math.max(rw, rh);
    const left = Math.floor((side - rw) / 2);
    const top = Math.floor((side - rh) / 2);
    const square = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(rw, rh, { fit: 'fill' })
      .extend({
        left,
        right: side - rw - left,
        top,
        bottom: side - rh - top,
        background: PAD_COLOR,
      })
      .flatten({ background: PAD_COLOR })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    const preview = await sharp(square)
      .resize(CUSTOM_MAP_LIMITS.previewPx, CUSTOM_MAP_LIMITS.previewPx)
      .webp({ quality: 75 })
      .toBuffer();
    return { image: square, preview, sizePx: side };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw invalid('Couldn’t read that image — try another file'); // sharp couldn't decode it
  }
}

export function toCustomMap(row: CustomMapRow, storage: AssetStorage): CustomMap {
  const image = storage.signedUrl(row.imageKey);
  const preview = storage.signedUrl(row.previewKey);
  return {
    id: row.id,
    roomId: row.roomId,
    name: row.name,
    widthM: row.widthM,
    imageUrl: image.url,
    previewUrl: preview.url,
    urlsExpireAt: Math.min(image.expiresAt, preview.expiresAt),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** for read-only viewers (share links, demo boards): no room id, no author */
export function toPublicCustomMap(row: CustomMapRow, storage: AssetStorage): PublicCustomMap {
  const { name, widthM, imageUrl, previewUrl, urlsExpireAt } = toCustomMap(row, storage);
  return { name, widthM, imageUrl, previewUrl, urlsExpireAt };
}

/**
 * Custom maps (FEATURES F20): images a room uploads to plan on. Listing: every member
 * (`room.view`); upload / rename / rescale / delete: owners and editors (`board.manage`).
 * Files get fresh random keys under `maps/<roomId>/`; the browser only sees signed URLs.
 */
export function createCustomMapService({
  prisma,
  policy,
  storage,
  log,
  events,
}: {
  prisma: PrismaClient;
  policy: RoomPolicy;
  storage: AssetStorage;
  log: FastifyBaseLogger;
  /** tells the room's live clients to refetch the list (a new width changes distances) */
  events?: RoomEvents;
}) {
  const changed = (roomId: string) => events?.emit('customMaps:changed', { roomId });
  const removeQuietly = (key: string) => {
    storage.remove(key).catch((err: unknown) => {
      log.warn({ err, key }, 'custom map file delete failed');
    });
  };

  async function find(roomId: string, mapId: string) {
    const row = await prisma.customMap.findFirst({ where: { id: mapId, roomId } });
    if (!row) throw new AppError('NOT_FOUND', 'Custom map not found');
    return row;
  }

  return {
    async list(user: AuthUser, roomId: string): Promise<CustomMap[]> {
      await policy.requireRoom(user, roomId, 'room.view');
      const rows = await prisma.customMap.findMany({
        where: { roomId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => toCustomMap(r, storage));
    },

    async upload(
      user: AuthUser,
      roomId: string,
      meta: { name: string; widthM: number },
      body: Buffer,
    ): Promise<CustomMap> {
      await policy.requireRoom(user, roomId, 'board.manage');
      if ((await prisma.customMap.count({ where: { roomId } })) >= CUSTOM_MAP_LIMITS.perRoom)
        throw new AppError(
          'LIMIT_REACHED',
          `A room can have at most ${CUSTOM_MAP_LIMITS.perRoom} custom maps`,
        );
      const { image, preview, sizePx } = await processMapImage(body);
      const token = randomToken(16).slice(0, 22); // 128 bits, base64url
      const imageKey = `maps/${roomId}/${token}.webp`;
      const previewKey = `maps/${roomId}/${token}-512.webp`;
      await storage.put(imageKey, image, 'image/webp');
      await storage.put(previewKey, preview, 'image/webp');
      try {
        const row = await prisma.$transaction(async (tx) => {
          // the cap holds under concurrent uploads: count again under the room lock
          await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
          if ((await tx.customMap.count({ where: { roomId } })) >= CUSTOM_MAP_LIMITS.perRoom)
            throw new AppError(
              'LIMIT_REACHED',
              `A room can have at most ${CUSTOM_MAP_LIMITS.perRoom} custom maps`,
            );
          return tx.customMap.create({
            data: {
              id: newId(),
              roomId,
              name: meta.name,
              widthM: meta.widthM,
              imageKey,
              previewKey,
              sizePx,
              createdBy: user.id,
            },
          });
        });
        changed(roomId);
        return toCustomMap(row, storage);
      } catch (err) {
        removeQuietly(imageKey);
        removeQuietly(previewKey);
        throw err;
      }
    },

    async update(
      user: AuthUser,
      roomId: string,
      mapId: string,
      body: { name?: string | undefined; widthM?: number | undefined },
    ): Promise<CustomMap> {
      await policy.requireRoom(user, roomId, 'board.manage');
      await find(roomId, mapId);
      const row = await prisma.customMap.update({
        where: { id: mapId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.widthM !== undefined ? { widthM: body.widthM } : {}),
        },
      });
      changed(roomId);
      return toCustomMap(row, storage);
    },

    /** only while no board uses it (409); its files go with it */
    async remove(user: AuthUser, roomId: string, mapId: string): Promise<void> {
      await policy.requireRoom(user, roomId, 'board.manage');
      const row = await find(roomId, mapId);
      const used = await prisma.board.count({ where: { customMapId: mapId } });
      if (used > 0)
        throw new AppError(
          'CONFLICT',
          `${used} board${used === 1 ? ' uses' : 's use'} this map — delete or change ${used === 1 ? 'it' : 'them'} first`,
        );
      try {
        await prisma.customMap.delete({ where: { id: mapId } });
      } catch (err) {
        // a board was created on it meanwhile: the foreign key refuses
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003')
          throw new AppError('CONFLICT', 'A board uses this map — delete or change it first');
        throw err;
      }
      changed(roomId);
      removeQuietly(row.imageKey);
      removeQuietly(row.previewKey);
    },
  };
}

export type CustomMapService = ReturnType<typeof createCustomMapService>;
