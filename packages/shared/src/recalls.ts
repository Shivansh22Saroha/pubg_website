import { z } from 'zod';
import { MAP_IDS } from './maps.js';
import { clusterSpawns } from './vehicleSpawns.js';

/**
 * Recall towers (2026-11, user feedback). Built by `packages/vehicle-spawns` from PUBG's official
 * API telemetry: a Blue Chip can only be used at a recall tower, so every `LogItemUse` of
 * `Item_Bluechip_C` in a sampled PC match marks a tower — the player stands at it. Nearby uses
 * across matches are merged into one tower. World units, like everything else (ARCHITECTURE §5);
 * PUBG telemetry uses the same centimetre coordinates. PC data: BGMI's towers may differ, which
 * the UI says next to the toggle.
 */

/** two uses closer than this (cm) are the same tower (the use radius around a tower is small) */
export const RECALL_MERGE_RADIUS = 1500;
/** a tower must be used in at least this many matches (one use may be a telemetry oddity) */
export const RECALL_MIN_MATCHES = 2;

export interface RecallSighting {
  x: number;
  y: number;
  matchId: string;
}

export const RecallTowerSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  /** in how many sampled matches a Blue Chip was used here */
  seen: z.number().int().min(1),
});
export type RecallTower = z.infer<typeof RecallTowerSchema>;

/** `apps/web/public/recalls/<mapId>.json` — validated on load like any other input */
export const RecallFileSchema = z.object({
  mapId: z.enum(MAP_IDS),
  source: z.literal('pubg-api'),
  shard: z.string().max(20),
  generatedAt: z.iso.datetime(),
  matches: z.number().int().min(0),
  towers: z.array(RecallTowerSchema).max(500),
});
export type RecallFile = z.infer<typeof RecallFileSchema>;

/** Merges Blue Chip uses into towers — the same greedy clustering as vehicle spawns. */
export function clusterRecalls(
  sightings: readonly RecallSighting[],
  worldSize: number,
  radius = RECALL_MERGE_RADIUS,
  minMatches = RECALL_MIN_MATCHES,
): RecallTower[] {
  return clusterSpawns(
    sightings.map((s) => ({ ...s, kind: 'car' as const })),
    worldSize,
    radius,
    minMatches,
  ).map(({ x, y, seen }) => ({ x, y, seen }));
}
