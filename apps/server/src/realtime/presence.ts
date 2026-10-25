import { PRESENCE_COLORS, type Presence } from '@rotationlab/shared';
import type { Redis } from 'ioredis';

const TTL_SEC = 60; // ARCHITECTURE §7.6: refreshed by the 20 s heartbeat
const STALE_MS = TTL_SEC * 1000;
const key = (roomId: string) => `rl:presence:${roomId}`;
const colorKey = (roomId: string) => `rl:presence-color:${roomId}`;
const field = (userId: string, socketId: string) => `${userId}|${socketId}`;

interface Entry {
  boardId: string | null;
  idle: boolean;
  at: number;
}

/**
 * Presence in Redis (ARCHITECTURE §7.6): one hash per room with a field per *socket*, so
 * several tabs of one user count once; entries whose heartbeat stopped (crashed instance)
 * are dropped on read. Each online user gets a colour no other online user in the room has.
 */
export function createPresence(redis: Redis, now: () => number = Date.now) {
  async function list(roomId: string): Promise<Presence[]> {
    const [raw, colors] = await Promise.all([
      redis.hgetall(key(roomId)),
      redis.hgetall(colorKey(roomId)),
    ]);
    const byUser = new Map<string, Entry[]>();
    const stale: string[] = [];
    for (const [f, v] of Object.entries(raw)) {
      const entry = JSON.parse(v) as Entry;
      if (entry.at < now() - STALE_MS) {
        stale.push(f);
        continue;
      }
      const userId = f.split('|')[0] ?? '';
      byUser.set(userId, [...(byUser.get(userId) ?? []), entry]);
    }
    if (stale.length > 0) await redis.hdel(key(roomId), ...stale);
    return [...byUser.entries()].map(([userId, entries]) => {
      const latest = entries.reduce((a, b) => (b.at > a.at ? b : a));
      return {
        userId,
        boardId: latest.boardId,
        idle: entries.every((e) => e.idle), // active in any tab = not idle
        color: colors[userId] ?? PRESENCE_COLORS[0],
      };
    });
  }

  async function assignColor(roomId: string, userId: string) {
    const existing = await redis.hget(colorKey(roomId), userId);
    if (existing) return;
    const online = new Set(
      (await list(roomId)).filter((p) => p.userId !== userId).map((p) => p.userId),
    );
    const colors = await redis.hgetall(colorKey(roomId));
    const taken = new Set(
      Object.entries(colors)
        .filter(([u]) => online.has(u))
        .map(([, c]) => c),
    );
    const free =
      PRESENCE_COLORS.find((c) => !taken.has(c)) ??
      PRESENCE_COLORS[online.size % PRESENCE_COLORS.length];
    await redis.hset(colorKey(roomId), userId, free ?? PRESENCE_COLORS[0]);
  }

  async function write(roomId: string, userId: string, socketId: string, entry: Omit<Entry, 'at'>) {
    await redis
      .multi()
      .hset(key(roomId), field(userId, socketId), JSON.stringify({ ...entry, at: now() }))
      .expire(key(roomId), TTL_SEC)
      .expire(colorKey(roomId), TTL_SEC * 60)
      .exec();
  }

  return {
    list,

    async join(roomId: string, userId: string, socketId: string) {
      await write(roomId, userId, socketId, { boardId: null, idle: false });
      await assignColor(roomId, userId);
    },

    update(roomId: string, userId: string, socketId: string, entry: Omit<Entry, 'at'>) {
      return write(roomId, userId, socketId, entry);
    },

    async leave(roomId: string, userId: string, socketId: string) {
      await redis.hdel(key(roomId), field(userId, socketId));
      const stillOnline = (await list(roomId)).some((p) => p.userId === userId);
      if (!stillOnline) await redis.hdel(colorKey(roomId), userId); // free the colour
    },

    /** drop every socket of a user (kick / leave) */
    async removeUser(roomId: string, userId: string) {
      const fields = (await redis.hkeys(key(roomId))).filter((f) => f.startsWith(`${userId}|`));
      if (fields.length > 0) await redis.hdel(key(roomId), ...fields);
      await redis.hdel(colorKey(roomId), userId);
    },
  };
}
export type PresenceStore = ReturnType<typeof createPresence>;
