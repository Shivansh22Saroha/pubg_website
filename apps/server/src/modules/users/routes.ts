import {
  ChangePasswordBodySchema,
  DeleteMeBodySchema,
  SessionIdParamsSchema,
  SessionsResponseSchema,
  UpdateMeBodySchema,
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
    async (req) => ({
      user: await auth.me(requireUser(req).id),
    }),
  );

  app.patch(
    '/me',
    { config: user, schema: { body: UpdateMeBodySchema, response: { 200: UserResponseSchema } } },
    async (req) => ({ user: await auth.updateMe(requireUser(req).id, req.body) }),
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
