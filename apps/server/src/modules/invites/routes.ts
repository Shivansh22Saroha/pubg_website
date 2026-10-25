import {
  AcceptInviteBodySchema,
  AcceptInviteResponseSchema,
  InviteCodeParamsSchema,
  InvitePreviewSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { requireUser } from '../../lib/policy.js';
import { byUser, fixedWindowLimit, LIMITS } from '../../plugins/rateLimit.js';
import type { InviteService } from './service.js';

/** /api/v1/invites/:code* — the join flow (API_SPEC §4, UF-5). */
export const inviteRoutes: FastifyPluginCallbackZod<{
  invites: InviteService;
  redis: Redis;
  rateLimits: boolean;
}> = (app, deps, done) => {
  const params = InviteCodeParamsSchema;

  // public, rate-limited (SECURITY Z7: 30/min/IP makes brute force infeasible)
  app.get(
    '/invites/:code',
    {
      config: { access: 'public', rateLimit: LIMITS.invitePreview },
      schema: { params, response: { 200: InvitePreviewSchema } },
    },
    async (req) => deps.invites.preview(req.params.code),
  );

  app.post(
    '/invites/:code/accept',
    {
      config: { access: 'user' },
      preHandler: fixedWindowLimit(
        deps.redis,
        deps.rateLimits,
        'invite-accept-hour',
        LIMITS.inviteAcceptHourly,
        byUser,
      ),
      schema: {
        params,
        body: AcceptInviteBodySchema,
        response: { 200: AcceptInviteResponseSchema },
      },
    },
    async (req) => ({
      roomId: await deps.invites.accept(requireUser(req), req.params.code, req.body.password),
    }),
  );

  done();
};
