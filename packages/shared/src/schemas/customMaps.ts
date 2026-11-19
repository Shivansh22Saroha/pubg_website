import { z } from 'zod';
import { CUSTOM_MAP_LIMITS } from '../maps.js';
import { textField } from '../text.js';

/** Custom maps (FEATURES F20): an image a room uploaded to plan on. */

export const CustomMapNameSchema = textField(1, CUSTOM_MAP_LIMITS.nameMax);

/** whole metres within the allowed range */
export const CustomMapWidthSchema = z
  .number()
  .int()
  .min(CUSTOM_MAP_LIMITS.widthMinM)
  .max(CUSTOM_MAP_LIMITS.widthMaxM);

export const CustomMapSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  name: z.string(),
  widthM: z.number().int(),
  /** short-lived signed URL of the full image (≤ 4096 px square WebP) */
  imageUrl: z.string(),
  /** short-lived signed URL of the 512 px preview */
  previewUrl: z.string(),
  /** when the signed URLs stop working (epoch ms) — refetch before */
  urlsExpireAt: z.number().int(),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type CustomMap = z.infer<typeof CustomMapSchema>;

export const CustomMapListResponseSchema = z.object({ items: z.array(CustomMapSchema) });
export const CustomMapResponseSchema = z.object({ customMap: CustomMapSchema });

/**
 * `POST /rooms/:roomId/custom-maps?name=…&widthM=…` with the image as the raw body. Query
 * values arrive as strings: the width must be digits only (no coercion of junk).
 */
export const UploadCustomMapQuerySchema = z.strictObject({
  name: CustomMapNameSchema,
  widthM: z
    .string()
    .regex(/^\d{1,6}$/, 'Width must be whole metres')
    .transform(Number)
    .pipe(CustomMapWidthSchema),
});
export type UploadCustomMapQuery = z.input<typeof UploadCustomMapQuerySchema>;

export const UpdateCustomMapBodySchema = z
  .strictObject({
    name: CustomMapNameSchema.optional(),
    widthM: CustomMapWidthSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type UpdateCustomMapBody = z.input<typeof UpdateCustomMapBodySchema>;

/** image types the upload accepts (checked by magic bytes too) */
export const CUSTOM_MAP_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const CustomMapParamsSchema = z.strictObject({ roomId: z.uuid(), mapId: z.uuid() });

/** local storage backend: `GET /assets/maps/:roomId/:file?exp=&sig=` */
export const MapAssetParamsSchema = z.strictObject({
  roomId: z.uuid(),
  file: z.string().regex(/^[A-Za-z0-9_-]{22}(?:-512)?\.webp$/),
});
export const SignedAssetQuerySchema = z.strictObject({
  exp: z.string().max(16).optional(),
  sig: z.string().max(64).optional(),
});
