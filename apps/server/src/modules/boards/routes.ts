import {
  BoardParamsSchema,
  BoardResponseSchema,
  BoardStateResponseSchema,
  UpdateBoardBodySchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireUser } from '../../lib/policy.js';
import type { BoardService } from './service.js';

/** /api/v1/boards/:boardId* (API_SPEC §5). Layer/element mutations are socket-only (Phase 5). */
export const boardRoutes: FastifyPluginCallbackZod<{ boards: BoardService }> = (
  app,
  { boards },
  done,
) => {
  const user = { access: 'user' } as const;
  const params = BoardParamsSchema;

  app.patch(
    '/boards/:boardId',
    {
      config: user,
      schema: { params, body: UpdateBoardBodySchema, response: { 200: BoardResponseSchema } },
    },
    async (req) => ({ board: await boards.update(requireUser(req), req.params.boardId, req.body) }),
  );

  app.delete('/boards/:boardId', { config: user, schema: { params } }, async (req, reply) => {
    await boards.remove(requireUser(req), req.params.boardId);
    return reply.status(204).send();
  });

  app.get(
    '/boards/:boardId/state',
    { config: user, schema: { params, response: { 200: BoardStateResponseSchema } } },
    async (req) => boards.state(requireUser(req), req.params.boardId),
  );

  done();
};
