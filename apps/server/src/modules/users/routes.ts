import {
  AVATAR_LIMITS,
  AVATAR_TYPES,
  AvatarAssetParamsSchema,
  ChangePasswordBodySchema,
  DeleteMeBodySchema,
  PrefsResponseSchema,
  SignedAssetQuerySchema,
  SessionIdParamsSchema,
  SessionsResponseSchema,
  UpdateMeBodySchema,
  UpdatePrefsBodySchema,
  UserResponseSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors.js';
import { requireUser } from '../../lib/policy.js';
import type { AssetStorage } from '../../lib/storage.js';
import { byUser, fixedWindowLimit, LIMITS } from '../../plugins/rateLimit.js';
import type { AuthCookies } from '../auth/cookies.js';
import type { AuthService } from '../auth/service.js';
import type { AccountService } from './account.js';
import type { AvatarService } from './avatar.js';

/** /api/v1/me* (API_SPEC §3), plus the profile photo (F23). */
export const userRoutes: FastifyPluginCallbackZod<{
  auth: AuthService;
  account: AccountService;
  cookies: AuthCookies;
  avatars: AvatarService;
  storage: AssetStorage;
  redis: Redis;
  rateLimits: boolean;
}> = (app, { auth, account, cookies, avatars, storage, redis, rateLimits }, done) => {
  const user = { access: 'user' } as const;

  // encapsulated: only this plugin's routes take an image body (PUT /me/avatar)
  for (const type of AVATAR_TYPES)
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: AVATAR_LIMITS.uploadMaxBytes },
      (_req, body, next) => {
        next(null, body);
      },
    );

  /** F23: the photo is the raw body (JPG / PNG / WebP ≤ 4 MB); returns the updated user */
  app.put(
    '/me/avatar',
    {
      config: user,
      preHandler: fixedWindowLimit(
        redis,
        rateLimits,
        'avatar-upload-hour',
        LIMITS.avatarUploadHourly,
        byUser,
      ),
      schema: { response: { 200: UserResponseSchema } },
    },
    async (req) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError('VALIDATION_ERROR', 'Send the photo as a JPG, PNG or WebP body');
      const u = requireUser(req);
      return {
        user: { ...(await avatars.set(u, req.body)), isAdmin: await app.isSiteAdmin(u.id) },
      };
    },
  );

  app.delete(
    '/me/avatar',
    { config: user, schema: { response: { 200: UserResponseSchema } } },
    async (req) => {
      const u = requireUser(req);
      return { user: { ...(await avatars.remove(u)), isAdmin: await app.isSiteAdmin(u.id) } };
    },
  );

  // Local backend only (S3 photos come from the bucket via presigned URLs). As for custom
  // maps, the signature is the access check, so <img> works; anything else is a plain 404.
  app.get(
    '/assets/avatars/:userId/:file',
    {
      config: { access: 'public' },
      schema: { params: AvatarAssetParamsSchema, querystring: SignedAssetQuerySchema },
    },
    async (req, reply) => {
      const key = `avatars/${req.params.userId}/${req.params.file}`;
      if (!storage.verifySigned(key, req.query.exp, req.query.sig))
        throw new AppError('NOT_FOUND', 'Not found');
      const data = await storage.read(key);
      if (!data) throw new AppError('NOT_FOUND', 'Not found');
      return reply
        .header('content-type', 'image/webp')
        .header('cache-control', 'private, max-age=21600')
        .header('x-content-type-options', 'nosniff')
        .send(data);
    },
  );

  app.get(
    '/me',
    { config: user, schema: { response: { 200: UserResponseSchema } } },
    async (req) => {
      const id = requireUser(req).id;
      return { user: { ...(await auth.me(id)), isAdmin: await app.isSiteAdmin(id) } };
    },
  );

  app.patch(
    '/me',
    { config: user, schema: { body: UpdateMeBodySchema, response: { 200: UserResponseSchema } } },
    async (req) => ({ user: await auth.updateMe(requireUser(req).id, req.body) }),
  );

  /** Phase 9: UI preferences that follow the user (the room tour), merged key by key. */
  app.patch(
    '/me/prefs',
    {
      config: user,
      schema: { body: UpdatePrefsBodySchema, response: { 200: PrefsResponseSchema } },
    },
    async (req) => ({ prefs: await auth.updatePrefs(requireUser(req).id, req.body) }),
  );

  app.post(
    '/me/password',
    { config: user, schema: { body: ChangePasswordBodySchema } },
    async (req, reply) => {
      const u = requireUser(req);
      await auth.changePassword(u.id, u.sid, req.body);
      return reply.status(204).send();
    },
  );

  app.get(
    '/me/sessions',
    { config: user, schema: { response: { 200: SessionsResponseSchema } } },
    async (req) => {
      const u = requireUser(req);
      return { items: await auth.sessions(u.id, u.sid) };
    },
  );

  /** AUTH-8: password + "DELETE"; owned rooms per `rooms` (or the fallback); logs out everywhere. */
  app.delete('/me', { config: user, schema: { body: DeleteMeBodySchema } }, async (req, reply) => {
    await account.deleteAccount(requireUser(req), req.body);
    cookies.clear(reply);
    return reply.status(204).send();
  });

  app.delete(
    '/me/sessions/:id',
    { config: user, schema: { params: SessionIdParamsSchema } },
    async (req, reply) => {
      await auth.revokeSession(requireUser(req).id, req.params.id);
      return reply.status(204).send();
    },
  );

  done();
};
