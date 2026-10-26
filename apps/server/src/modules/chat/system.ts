import type { PrismaClient } from '@prisma/client';
import type { RoomRole } from '@rotationlab/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { RoomEvents } from '../rooms/events.js';
import type { ChatService } from './service.js';

const ROLE_NAME: Record<RoomRole, string> = {
  OWNER: 'the owner',
  EDITOR: 'an Editor',
  VIEWER: 'a Viewer',
};

/**
 * System messages (FEATURES F9) derived from the domain events the REST services already raise,
 * so every path that changes membership or boards produces one. Fire-and-forget: a failure is
 * logged and never affects the request that raised the event. `idle()` resolves once every
 * message in flight is written (graceful shutdown; tests drain it before truncating tables).
 */
export function registerSystemMessages(
  events: RoomEvents,
  chat: ChatService,
  prisma: PrismaClient,
  log: FastifyBaseLogger,
): { idle: () => Promise<void> } {
  const inFlight = new Set<Promise<unknown>>();
  const say = (roomId: string, body: Promise<string | null> | string | null) => {
    const p = Promise.resolve(body)
      .then((text) => (text ? chat.system(roomId, text) : null))
      .catch((err: unknown) => {
        log.warn({ err, roomId }, 'system chat message failed');
      })
      .finally(() => {
        inFlight.delete(p);
      });
    inFlight.add(p);
  };
  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }))
      ?.displayName ?? null;

  events.on('member:joined', ({ roomId, member }) => {
    say(roomId, `${member.user.displayName} joined the room`);
  });
  events.on('member:left', ({ roomId, userId }) => {
    say(
      roomId,
      nameOf(userId).then((n) => (n ? `${n} left the room` : null)),
    );
  });
  events.on('member:kicked', ({ roomId, userId }) => {
    say(
      roomId,
      nameOf(userId).then((n) => (n ? `${n} was removed from the room` : null)),
    );
  });
  events.on('member:roleChanged', ({ roomId, userId, role }) => {
    say(
      roomId,
      nameOf(userId).then((n) => (n ? `${n} is now ${ROLE_NAME[role]}` : null)),
    );
  });
  events.on('board:created', ({ roomId, board }) => {
    say(roomId, `Board “${board.name}” was created`);
  });
  events.on('board:deleted', ({ roomId, name }) => {
    say(roomId, `Board “${name}” was deleted`);
  });
  events.on('snapshot:saved', ({ roomId, userId, name }) => {
    say(
      roomId,
      nameOf(userId).then((n) => `${n ?? 'Someone'} saved snapshot '${name}'`),
    );
  });
  events.on('snapshot:restored', ({ roomId, userId, name }) => {
    say(
      roomId,
      nameOf(userId).then((n) => `${n ?? 'Someone'} restored snapshot '${name}'`),
    );
  });
  events.on('layer:cleared', ({ roomId, userId, layerName, count }) => {
    say(
      roomId,
      nameOf(userId).then(
        (n) =>
          `${n ?? 'Someone'} cleared layer '${layerName}' (${count} elements) — an automatic snapshot was saved`,
      ),
    );
  });

  return {
    idle: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
