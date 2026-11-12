import type { AdminStats } from '@rotationlab/shared';
import type { PrismaClient } from '@prisma/client';

const DAYS = 30;
/** the demo owner (seed) has an `.invalid` address — not a person */
const REAL_USER = `u.deleted_at IS NULL AND u.email NOT LIKE '%.invalid'`;

/** "shivansh@gmail.com" → "sh••••@gmail.com" (at most four dots: the length stays private) */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}${'•'.repeat(Math.min(4, Math.max(1, local.length - 2)))}${email.slice(at)}`;
}

/** zero-fill a day series: every date of the window, oldest first */
export function fillDays(rows: { day: Date; count: bigint | number }[], now: Date, days = DAYS) {
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Site-wide numbers for the admin dashboard (FEATURES F16). Read-only aggregate queries. */
export function createAdminStats(prisma: PrismaClient) {
  return {
    async stats(now = new Date()): Promise<AdminStats> {
      const [totals] = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(`
        SELECT
          (SELECT count(*) FROM users u WHERE ${REAL_USER}) AS users,
          (SELECT count(*) FROM users u WHERE ${REAL_USER} AND u.email_verified_at IS NOT NULL) AS verified,
          (SELECT count(*) FROM rooms WHERE deleted_at IS NULL) AS rooms,
          (SELECT count(*) FROM boards b JOIN rooms r ON r.id = b.room_id WHERE r.deleted_at IS NULL) AS boards,
          (SELECT count(*) FROM elements) AS drawings,
          (SELECT count(*) FROM chat_messages WHERE deleted_at IS NULL) AS chat,
          (SELECT count(*) FROM snapshots) AS snapshots,
          (SELECT count(*) FROM share_links) AS shares,
          (SELECT count(DISTINCT user_id) FROM refresh_tokens WHERE created_at > now() - interval '1 day') AS a1,
          (SELECT count(DISTINCT user_id) FROM refresh_tokens WHERE created_at > now() - interval '7 days') AS a7,
          (SELECT count(DISTINCT user_id) FROM refresh_tokens WHERE created_at > now() - interval '30 days') AS a30
      `);
      const signups = await prisma.$queryRawUnsafe<{ day: Date; count: bigint }[]>(`
        SELECT date_trunc('day', u.created_at AT TIME ZONE 'UTC') AS day, count(*) AS count
        FROM users u WHERE ${REAL_USER} AND u.created_at > now() - interval '${DAYS} days'
        GROUP BY 1`);
      const active = await prisma.$queryRawUnsafe<{ day: Date; count: bigint }[]>(`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, count(DISTINCT user_id) AS count
        FROM refresh_tokens WHERE created_at > now() - interval '${DAYS} days'
        GROUP BY 1`);
      const maps = await prisma.$queryRawUnsafe<{ map_id: string; boards: bigint }[]>(`
        SELECT b.map_id, count(*) AS boards FROM boards b JOIN rooms r ON r.id = b.room_id
        WHERE r.deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC`);
      const rooms = await prisma.$queryRawUnsafe<
        { name: string; members: bigint; boards: bigint; drawings: bigint; created_at: Date }[]
      >(`
        SELECT r.name, r.created_at,
          (SELECT count(*) FROM room_members m WHERE m.room_id = r.id) AS members,
          (SELECT count(*) FROM boards b WHERE b.room_id = r.id) AS boards,
          (SELECT count(*) FROM elements e JOIN boards b ON b.id = e.board_id WHERE b.room_id = r.id) AS drawings
        FROM rooms r WHERE r.deleted_at IS NULL
        ORDER BY drawings DESC, members DESC, r.created_at DESC LIMIT 10`);
      const recent = await prisma.$queryRawUnsafe<
        {
          username: string;
          display_name: string;
          email: string;
          email_verified_at: Date | null;
          created_at: Date;
          rooms: bigint;
        }[]
      >(`
        SELECT u.username, u.display_name, u.email, u.email_verified_at, u.created_at,
          (SELECT count(*) FROM room_members m WHERE m.user_id = u.id) AS rooms
        FROM users u WHERE ${REAL_USER} ORDER BY u.created_at DESC LIMIT 25`);
      return {
        generatedAt: now.toISOString(),
        totals: {
          users: n(totals?.users),
          verifiedUsers: n(totals?.verified),
          rooms: n(totals?.rooms),
          boards: n(totals?.boards),
          drawings: n(totals?.drawings),
          chatMessages: n(totals?.chat),
          snapshots: n(totals?.snapshots),
          shareLinks: n(totals?.shares),
        },
        active: { last24h: n(totals?.a1), last7d: n(totals?.a7), last30d: n(totals?.a30) },
        signupsByDay: fillDays(signups, now),
        activeByDay: fillDays(active, now),
        boardsByMap: maps.map((m) => ({ mapId: m.map_id.toLowerCase(), boards: n(m.boards) })),
        topRooms: rooms.map((r) => ({
          name: r.name,
          members: n(r.members),
          boards: n(r.boards),
          drawings: n(r.drawings),
          createdAt: r.created_at.toISOString(),
        })),
        recentUsers: recent.map((u) => ({
          username: u.username,
          displayName: u.display_name,
          emailMasked: maskEmail(u.email),
          verified: u.email_verified_at !== null,
          rooms: n(u.rooms),
          createdAt: u.created_at.toISOString(),
        })),
      };
    },
  };
}
export type AdminStatsService = ReturnType<typeof createAdminStats>;
