import { z } from 'zod';

export const DependencyStatusSchema = z.enum(['ok', 'error']);
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

/** `GET /api/health` (API_SPEC §8). `status` is `degraded` (HTTP 503) when a dependency is down. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: DependencyStatusSchema,
  redis: DependencyStatusSchema,
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** `GET /api/live` — the process answers; touches no dependency (keep-warm pings, DEPLOYMENT §10) */
export const LiveResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type LiveResponse = z.infer<typeof LiveResponseSchema>;
