import {
  ChangePasswordBodySchema,
  DeleteMeBodySchema,
  PrefsResponseSchema,
  SessionIdParamsSchema,
  SessionsResponseSchema,
  UpdateMeBodySchema,
  UpdatePrefsBodySchema,
  UserResponseSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireUser } from '../../lib/policy.js';
import type { AuthCookies } from '../auth/cookies.js';
import type { AuthService } from '../auth/service.js';
import type { AccountService } from './account.js';

/** /api/v1/me* (API_SPEC §3). */
export const userRoutes: FastifyPluginCallbackZod<{
  auth: AuthService;
  account: AccountService;
  cookies: AuthCookies;
}> = (app, { auth, account, cookies }, done) => {
  const user = { access: 'user' } as const;

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
