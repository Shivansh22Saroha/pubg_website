import {
  BoardParamsSchema,
  CreateSnapshotBodySchema,
  RestoreSnapshotResponseSchema,
  SnapshotDetailResponseSchema,
  SnapshotParamsSchema,
  SnapshotResponseSchema,
  SnapshotsResponseSchema,
} from '@rotationlab/shared';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireUser } from '../../lib/policy.js';
import type { SnapshotService } from './service.js';

/** Snapshots (API_SPEC §5). Restore broadcasts `board:reset` once committed. */
export const snapshotRoutes: FastifyPluginCallbackZod<{ snapshots: SnapshotService }> = (
  app,
  { snapshots },
  done,
) => {
  const user = { access: 'user' } as const;

  app.get(
    '/boards/:boardId/snapshots',
    {
      config: user,
      schema: { params: BoardParamsSchema, response: { 200: SnapshotsResponseSchema } },
    },
    async (req) => ({ items: await snapshots.list(requireUser(req), req.params.boardId) }),
  );

  app.post(
    '/boards/:boardId/snapshots',
    {
      config: user,
      schema: {
        params: BoardParamsSchema,
        body: CreateSnapshotBodySchema,
        response: { 201: SnapshotResponseSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send({
        snapshot: await snapshots.create(requireUser(req), req.params.boardId, req.body.name),
      }),
  );

  app.get(
    '/snapshots/:snapshotId',
    {
      config: user,
      schema: { params: SnapshotParamsSchema, response: { 200: SnapshotDetailResponseSchema } },
    },
    async (req) => snapshots.get(requireUser(req), req.params.snapshotId),
  );

  app.post(
    '/snapshots/:snapshotId/restore',
    {
      config: user,
      schema: { params: SnapshotParamsSchema, response: { 200: RestoreSnapshotResponseSchema } },
    },
    async (req) => snapshots.restore(requireUser(req), req.params.snapshotId),
  );

  app.delete(
    '/snapshots/:snapshotId',
    { config: user, schema: { params: SnapshotParamsSchema } },
    async (req, reply) => {
      await snapshots.remove(requireUser(req), req.params.snapshotId);
      return reply.status(204).send();
    },
  );

  done();
};
