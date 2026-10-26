import {
  MessageParamsSchema,
  MessagesQuerySchema,
  MessagesResponseSchema,
  RoomParamsSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireUser } from '../../lib/policy.js';
import type { ChatService } from './service.js';

/** Chat history and deletion (API_SPEC §6). Sending is socket-only (`chat:send`). */
export const chatRoutes: FastifyPluginCallbackZod<{ chat: ChatService }> = (
  app,
  { chat },
  done,
) => {
  const user = { access: 'user' } as const;

  app.get(
    '/rooms/:roomId/messages',
    {
      config: user,
      schema: {
        params: RoomParamsSchema,
        querystring: MessagesQuerySchema,
        response: { 200: MessagesResponseSchema },
      },
    },
    async (req) => chat.list(requireUser(req), req.params.roomId, req.query),
  );

  app.delete(
    '/messages/:messageId',
    { config: user, schema: { params: MessageParamsSchema } },
    async (req, reply) => {
      await chat.remove(requireUser(req), req.params.messageId);
      return reply.status(204).send();
    },
  );

  done();
};
