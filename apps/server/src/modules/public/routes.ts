import { DemoBoardsResponseSchema } from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { LIMITS } from '../../plugins/rateLimit.js';
import type { PublicService } from './service.js';

/** /api/v1/public/* — no auth (API_SPEC §8). */
export const publicRoutes: FastifyPluginCallbackZod<{ service: PublicService }> = (
  app,
  { service },
  done,
) => {
  app.get(
    '/public/demo-boards',
    {
      config: { access: 'public', rateLimit: LIMITS.demoBoards },
      schema: { response: { 200: DemoBoardsResponseSchema } },
    },
    async (_req, reply) => {
      reply.header('cache-control', 'public, max-age=300');
      return { items: await service.demoBoards() };
    },
  );
  done();
};
