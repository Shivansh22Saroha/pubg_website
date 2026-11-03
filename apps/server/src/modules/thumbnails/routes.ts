import {
  AssetParamsSchema,
  BoardParamsSchema,
  THUMBNAIL,
  ThumbnailResponseSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors.js';
import { requireUser } from '../../lib/policy.js';
import type { AssetStorage } from '../../lib/storage.js';
import type { ThumbnailService } from './service.js';

/**
 * `PUT /boards/:boardId/thumbnail` (raw `image/jpeg` body ≤ 100 KB) and, for the local storage
 * backend, `GET /assets/*` serving the stored files.
 */
export const thumbnailRoutes: FastifyPluginCallbackZod<{
  thumbnails: ThumbnailService;
  storage: AssetStorage;
}> = (app, { thumbnails, storage }, done) => {
  // encapsulated: only this plugin's routes accept a JPEG body
  app.addContentTypeParser(
    'image/jpeg',
    { parseAs: 'buffer', bodyLimit: THUMBNAIL.maxBytes },
    (_req, body, next) => {
      next(null, body);
    },
  );

  app.put(
    '/boards/:boardId/thumbnail',
    {
      config: { access: 'user' },
      schema: { params: BoardParamsSchema, response: { 200: ThumbnailResponseSchema } },
    },
    async (req) => {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError('VALIDATION_ERROR', 'Send the thumbnail as an image/jpeg body');
      }
      return {
        thumbnailUrl: await thumbnails.upload(requireUser(req), req.params.boardId, req.body),
      };
    },
  );

  // Local backend only (S3 objects are served by the bucket / CDN). Keys are unguessable
  // (128-bit), like the S3 URLs; only server-written key shapes are ever read.
  app.get(
    '/assets/thumbnails/:boardId/:file',
    { config: { access: 'public' }, schema: { params: AssetParamsSchema } },
    async (req, reply) => {
      const data = await storage.read(`thumbnails/${req.params.boardId}/${req.params.file}`);
      if (!data) throw new AppError('NOT_FOUND', 'Not found');
      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(data);
    },
  );

  done();
};
