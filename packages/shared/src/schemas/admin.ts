import { z } from 'zod';

/**
 * Site admin dashboard (FEATURES F16, API_SPEC §15): GET /api/v1/admin/stats. Only accounts
 * whose email is in the server's ADMIN_EMAILS see it; everyone else gets 404. Aggregate counts
 * plus the newest accounts (email masked) — no passwords, tokens, chat contents or IPs.
 */
const DayCountSchema = z.object({ date: z.iso.date(), count: z.number().int().nonnegative() });

export const AdminStatsSchema = z.object({
  generatedAt: z.iso.datetime(),
  totals: z.object({
    users: z.number().int().nonnegative(),
    verifiedUsers: z.number().int().nonnegative(),
    rooms: z.number().int().nonnegative(),
    boards: z.number().int().nonnegative(),
    drawings: z.number().int().nonnegative(),
    chatMessages: z.number().int().nonnegative(),
    snapshots: z.number().int().nonnegative(),
    shareLinks: z.number().int().nonnegative(),
  }),
  /** distinct accounts that logged in or refreshed a session in the window */
  active: z.object({
    last24h: z.number().int().nonnegative(),
    last7d: z.number().int().nonnegative(),
    last30d: z.number().int().nonnegative(),
  }),
  /** last 30 days, oldest first, every day present (zero-filled) */
  signupsByDay: z.array(DayCountSchema),
  activeByDay: z.array(DayCountSchema),
  boardsByMap: z.array(z.object({ mapId: z.string(), boards: z.number().int().nonnegative() })),
  topRooms: z.array(
    z.object({
      name: z.string(),
      members: z.number().int().nonnegative(),
      boards: z.number().int().nonnegative(),
      drawings: z.number().int().nonnegative(),
      createdAt: z.iso.datetime(),
    }),
  ),
  recentUsers: z.array(
    z.object({
      username: z.string(),
      displayName: z.string(),
      /** "sh•••@gmail.com" */
      emailMasked: z.string(),
      verified: z.boolean(),
      rooms: z.number().int().nonnegative(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type AdminStats = z.infer<typeof AdminStatsSchema>;
export const AdminStatsResponseSchema = z.object({ stats: AdminStatsSchema });
