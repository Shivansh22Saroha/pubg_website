import {
  CUSTOM_MAP_LIMITS,
  CustomMapListResponseSchema,
  CustomMapParamsSchema,
  CustomMapResponseSchema,
  CUSTOM_MAP_TYPES,
  MapAssetParamsSchema,
  RoomParamsSchema,
  SignedAssetQuerySchema,
  UpdateCustomMapBodySchema,
  UploadCustomMapQuerySchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import { requireUser } from '../../lib/policy.js';
import type { AssetStorage } from '../../lib/storage.js';
import { byUser, fixedWindowLimit, LIMITS } from '../../plugins/rateLimit.js';
import type { CustomMapService } from './service.js';

/**
 * Custom maps (FEATURES F20, API_SPEC §5a): list / upload (raw image body, ≤ 8 MB, name and
 * width in the query) / rename-rescale / delete under a room, and — local storage backend only —
 * `GET /assets/maps/*` serving the files to holders of a valid signed link.
 */
export const customMapRoutes: FastifyPluginCallbackZod<{
  customMaps: CustomMapService;
  storage: AssetStorage;
  redis: Redis;
  rateLimits: boolean;
}> = (app, { customMaps, storage, redis, rateLimits }, done) => {
  // encapsulated: only this plugin's routes take an image body
  for (const type of CUSTOM_MAP_TYPES)
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: CUSTOM_MAP_LIMITS.uploadMaxBytes },
      (_req, body, next) => {
        next(null, body);
      },
    );

  app.get(
    '/rooms/:roomId/custom-maps',
    {
      config: { access: 'user' },
      schema: { params: RoomParamsSchema, response: { 200: CustomMapListResponseSchema } },
    },
    async (req) => ({ items: await customMaps.list(requireUser(req), req.params.roomId) }),
  );

  app.post(
    '/rooms/:roomId/custom-maps',
    {
      config: { access: 'user' },
      preHandler: fixedWindowLimit(
        redis,
        rateLimits,
        'custom-map-upload-hour',
        LIMITS.customMapUploadHourly,
        byUser,
      ),
      schema: {
        params: RoomParamsSchema,
        querystring: UploadCustomMapQuerySchema,
        response: { 201: CustomMapResponseSchema },
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError('VALIDATION_ERROR', 'Send the map as a JPG, PNG or WebP body');
      const customMap = await customMaps.upload(
        requireUser(req),
        req.params.roomId,
        req.query,
        req.body,
      );
      return reply.code(201).send({ customMap });
    },
  );

  app.patch(
    '/rooms/:roomId/custom-maps/:mapId',
    {
      config: { access: 'user' },
      schema: {
        params: CustomMapParamsSchema,
        body: UpdateCustomMapBodySchema,
        response: { 200: CustomMapResponseSchema },
      },
    },
    async (req) => ({
      customMap: await customMaps.update(
        requireUser(req),
        req.params.roomId,
        req.params.mapId,
        req.body,
      ),
    }),
  );

  app.delete(
    '/rooms/:roomId/custom-maps/:mapId',
    { config: { access: 'user' }, schema: { params: CustomMapParamsSchema } },
    async (req, reply) => {
      await customMaps.remove(requireUser(req), req.params.roomId, req.params.mapId);
      return reply.code(204).send();
    },
  );

  // Local backend only (S3 objects are fetched from the bucket with presigned URLs). The
  // signature, not a session, is the access check — like the presigned URLs — so `<img>` works
  // without credentials; a missing / expired / tampered link is a plain 404.
  app.get(
    '/assets/maps/:roomId/:file',
    {
      config: { access: 'public' },
      schema: { params: MapAssetParamsSchema, querystring: SignedAssetQuerySchema },
    },
    async (req, reply) => {
      const key = `maps/${req.params.roomId}/${req.params.file}`;
      if (!storage.verifySigned(key, req.query.exp, req.query.sig))
        throw new AppError('NOT_FOUND', 'Not found');
      const data = await storage.read(key);
      if (!data) throw new AppError('NOT_FOUND', 'Not found');
      return (
        reply
          .header('content-type', 'image/webp')
          // the URL changes when the signature window does; private: no shared caches
          .header('cache-control', 'private, max-age=21600')
          .header('x-content-type-options', 'nosniff')
          .send(data)
      );
    },
  );

  done();
};
