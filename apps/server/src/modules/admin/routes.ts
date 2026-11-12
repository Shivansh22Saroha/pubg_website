import { AdminStatsResponseSchema } from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { AdminStatsService } from './stats.js';

/** /api/v1/admin/* (API_SPEC §15). `admin` access: anyone not in ADMIN_EMAILS gets 404. */
export const adminRoutes: FastifyPluginCallbackZod<{ stats: AdminStatsService }> = (
  app,
  { stats },
  done,
) => {
  app.get(
    '/admin/stats',
    { config: { access: 'admin' }, schema: { response: { 200: AdminStatsResponseSchema } } },
    async (_req, reply) => {
      reply.header('cache-control', 'no-store');
      return { stats: await stats.stats() };
    },
  );
  done();
};
