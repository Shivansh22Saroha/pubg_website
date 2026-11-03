import {
  BoardParamsSchema,
  CreateShareLinkBodySchema,
  ShareLinkCreatedResponseSchema,
  ShareLinkStatusResponseSchema,
  SharedBoardResponseSchema,
  ShareTokenParamsSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireUser } from '../../lib/policy.js';
import { LIMITS } from '../../plugins/rateLimit.js';
import type { ShareService } from './service.js';

/** Board share links (API_SPEC §5b): managed by owner / editor, read by anyone with the token. */
export const shareRoutes: FastifyPluginCallbackZod<{ share: ShareService }> = (
  app,
  { share },
  done,
) => {
  const user = { access: 'user' } as const;
  const params = BoardParamsSchema;

  app.get(
    '/boards/:boardId/share',
    { config: user, schema: { params, response: { 200: ShareLinkStatusResponseSchema } } },
    async (req) => ({ share: await share.status(requireUser(req), req.params.boardId) }),
  );

  app.post(
    '/boards/:boardId/share',
    {
      config: user,
      schema: {
        params,
        body: CreateShareLinkBodySchema,
        response: { 201: ShareLinkCreatedResponseSchema },
      },
    },
    async (req, reply) => {
      const created = await share.create(requireUser(req), req.params.boardId, req.body.expiresIn);
      reply.header('cache-control', 'no-store'); // carries the only copy of the URL
      return reply.status(201).send(created);
    },
  );

  app.delete('/boards/:boardId/share', { config: user, schema: { params } }, async (req, reply) => {
    await share.revoke(requireUser(req), req.params.boardId);
    return reply.status(204).send();
  });

  app.get(
    '/public/share/:token',
    {
      config: { access: 'public', rateLimit: LIMITS.sharedBoard },
      schema: { params: ShareTokenParamsSchema, response: { 200: SharedBoardResponseSchema } },
    },
    async (req, reply) => {
      // revocation must bite at once: no shared or browser cache; the token stays out of logs'
      // Referer on outbound requests (the page sets no-referrer too)
      reply.header('cache-control', 'no-store');
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-robots-tag', 'noindex');
      return share.read(req.params.token);
    },
  );

  done();
};
