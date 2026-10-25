import {
  BoardResponseSchema,
  BoardsResponseSchema,
  CreateBoardBodySchema,
  CreateInviteBodySchema,
  CreateRoomBodySchema,
  CreateRoomResponseSchema,
  DeleteRoomBodySchema,
  InviteResponseSchema,
  InvitesResponseSchema,
  MemberResponseSchema,
  MembersResponseSchema,
  RoomDetailResponseSchema,
  RoomInviteParamsSchema,
  RoomListResponseSchema,
  RoomMemberParamsSchema,
  RoomParamsSchema,
  RoomResponseSchema,
  SetRoomPasswordBodySchema,
  TransferRoomBodySchema,
  UpdateMemberBodySchema,
  UpdateRoomBodySchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { requireUser } from '../../lib/policy.js';
import { byUser, fixedWindowLimit, LIMITS } from '../../plugins/rateLimit.js';
import type { BoardService } from '../boards/service.js';
import type { InviteService } from '../invites/service.js';
import type { RoomService } from './service.js';

export interface RoomRouteDeps {
  rooms: RoomService;
  invites: InviteService;
  boards: BoardService;
  redis: Redis;
  rateLimits: boolean;
}

/**
 * /api/v1/rooms/* (API_SPEC §4–5). Every handler resolves the caller's role through the room
 * policy inside the service (non-members → 404, too-low role → 403).
 */
export const roomRoutes: FastifyPluginCallbackZod<RoomRouteDeps> = (app, deps, done) => {
  const { rooms, invites, boards } = deps;
  const user = { access: 'user' } as const;
  const params = RoomParamsSchema;

  // ---- rooms -------------------------------------------------------------------------
  app.get(
    '/rooms',
    { config: user, schema: { response: { 200: RoomListResponseSchema } } },
    async (req) => ({
      items: await rooms.list(requireUser(req).id),
    }),
  );

  app.post(
    '/rooms',
    {
      config: user,
      preHandler: fixedWindowLimit(
        deps.redis,
        deps.rateLimits,
        'room-create-day',
        LIMITS.roomCreateDaily,
        byUser,
      ),
      schema: { body: CreateRoomBodySchema, response: { 201: CreateRoomResponseSchema } },
    },
    async (req, reply) => reply.status(201).send(await rooms.create(requireUser(req), req.body)),
  );

  app.get(
    '/rooms/:roomId',
    { config: user, schema: { params, response: { 200: RoomDetailResponseSchema } } },
    async (req) => rooms.detail(requireUser(req), req.params.roomId),
  );

  app.patch(
    '/rooms/:roomId',
    {
      config: user,
      schema: { params, body: UpdateRoomBodySchema, response: { 200: RoomResponseSchema } },
    },
    async (req) => ({ room: await rooms.update(requireUser(req), req.params.roomId, req.body) }),
  );

  app.put(
    '/rooms/:roomId/password',
    { config: user, schema: { params, body: SetRoomPasswordBodySchema } },
    async (req, reply) => {
      await rooms.setPassword(requireUser(req), req.params.roomId, req.body.password);
      return reply.status(204).send();
    },
  );

  app.delete(
    '/rooms/:roomId',
    { config: user, schema: { params, body: DeleteRoomBodySchema } },
    async (req, reply) => {
      await rooms.remove(requireUser(req), req.params.roomId, req.body.confirmName);
      return reply.status(204).send();
    },
  );

  app.post('/rooms/:roomId/leave', { config: user, schema: { params } }, async (req, reply) => {
    await rooms.leave(requireUser(req), req.params.roomId);
    return reply.status(204).send();
  });

  app.post(
    '/rooms/:roomId/transfer',
    { config: user, schema: { params, body: TransferRoomBodySchema } },
    async (req, reply) => {
      await rooms.transfer(requireUser(req), req.params.roomId, req.body.userId, req.body.password);
      return reply.status(204).send();
    },
  );

  // ---- members -----------------------------------------------------------------------
  app.get(
    '/rooms/:roomId/members',
    { config: user, schema: { params, response: { 200: MembersResponseSchema } } },
    async (req) => ({ items: await rooms.members(requireUser(req), req.params.roomId) }),
  );

  app.patch(
    '/rooms/:roomId/members/:userId',
    {
      config: user,
      schema: {
        params: RoomMemberParamsSchema,
        body: UpdateMemberBodySchema,
        response: { 200: MemberResponseSchema },
      },
    },
    async (req) => ({
      member: await rooms.setMemberRole(
        requireUser(req),
        req.params.roomId,
        req.params.userId,
        req.body.role,
      ),
    }),
  );

  app.delete(
    '/rooms/:roomId/members/:userId',
    { config: user, schema: { params: RoomMemberParamsSchema } },
    async (req, reply) => {
      await rooms.kick(requireUser(req), req.params.roomId, req.params.userId);
      return reply.status(204).send();
    },
  );

  // ---- invites (room-scoped) ---------------------------------------------------------
  app.get(
    '/rooms/:roomId/invites',
    { config: user, schema: { params, response: { 200: InvitesResponseSchema } } },
    async (req) => ({ items: await invites.list(requireUser(req), req.params.roomId) }),
  );

  app.post(
    '/rooms/:roomId/invites',
    {
      config: user,
      schema: { params, body: CreateInviteBodySchema, response: { 201: InviteResponseSchema } },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send({ invite: await invites.create(requireUser(req), req.params.roomId, req.body) }),
  );

  app.delete(
    '/rooms/:roomId/invites/:inviteId',
    { config: user, schema: { params: RoomInviteParamsSchema } },
    async (req, reply) => {
      await invites.revoke(requireUser(req), req.params.roomId, req.params.inviteId);
      return reply.status(204).send();
    },
  );

  // ---- boards (room-scoped) ----------------------------------------------------------
  app.get(
    '/rooms/:roomId/boards',
    { config: user, schema: { params, response: { 200: BoardsResponseSchema } } },
    async (req) => ({ items: await boards.list(requireUser(req), req.params.roomId) }),
  );

  app.post(
    '/rooms/:roomId/boards',
    {
      config: user,
      schema: { params, body: CreateBoardBodySchema, response: { 201: BoardResponseSchema } },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send({ board: await boards.create(requireUser(req), req.params.roomId, req.body) }),
  );

  done();
};
