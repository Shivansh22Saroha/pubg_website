import { z } from 'zod';
import { MAP_IDS, type MapId } from './maps.js';

/**
 * Vehicle spawn points (2026-11, user feedback). Built by `packages/vehicle-spawns` from PUBG's
 * official API telemetry: in sampled PC matches, the spot where each vehicle is *first* entered
 * is where it spawned (it sits there until someone gets in). Nearby sightings across matches are
 * merged into one point. World units, like everything else (ARCHITECTURE §5) — PUBG telemetry
 * uses the same centimetre coordinates, so no conversion. PC data: BGMI's spawns may differ,
 * which the UI says next to the toggle.
 */
export const VEHICLE_KINDS = ['car', 'bike', 'boat', 'glider'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

export const VEHICLE_KIND_NAMES: Record<VehicleKind, string> = {
  car: 'Cars',
  bike: 'Bikes',
  boat: 'Boats',
  glider: 'Gliders',
};

/**
 * Telemetry `vehicleType` (e.g. `Dacia_A_01_v2_C`) → kind, or null for vehicles that don't
 * spawn at fixed points (flare-gun BRDM, trains, event trucks, comeback / emergency pickups).
 */
export function vehicleKindOf(vehicleType: string): VehicleKind | null {
  const t = vehicleType.toLowerCase();
  if (/brdm|train|killtruck|loottruck|food_truck|emergencypickup|bluezone|pillar|dummy/.test(t))
    return null;
  if (/boat|aquarail/.test(t)) return 'boat';
  if (/glider/.test(t)) return 'glider';
  if (/motorbike|dirtbike|scooter|bicycle|snowbike|snowmobile|atv|bike/.test(t)) return 'bike';
  return 'car';
}

/** two first-ride sightings closer than this (cm) are the same spawn point */
export const SPAWN_MERGE_RADIUS = 1500;
/** a point must be seen in at least this many matches (one sighting may be a moved vehicle) */
export const SPAWN_MIN_MATCHES = 2;

export interface SpawnSighting {
  x: number;
  y: number;
  kind: VehicleKind;
  matchId: string;
}

export const VehicleSpawnSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  kind: z.enum(VEHICLE_KINDS),
  /** in how many sampled matches a vehicle was first entered here */
  seen: z.number().int().min(1),
});
export type VehicleSpawn = z.infer<typeof VehicleSpawnSchema>;

/** `apps/web/public/spawns/<mapId>.json` — validated on load like any other input */
export const VehicleSpawnFileSchema = z.object({
  mapId: z.enum(MAP_IDS),
  source: z.literal('pubg-api'),
  /** PUBG API platform shard the matches came from */
  shard: z.string().max(20),
  generatedAt: z.iso.datetime(),
  matches: z.number().int().min(0),
  spawns: z.array(VehicleSpawnSchema).max(5000),
});
export type VehicleSpawnFile = z.infer<typeof VehicleSpawnFileSchema>;

/**
 * Merges sightings into spawn points: greedy clustering on a hash grid (cell = merge radius),
 * one kind per point (the most common one), centroid position, counted by distinct matches.
 * Deterministic for the same input order. Points seen in fewer than `minMatches` matches are
 * dropped, and the result is sorted by kind, then y, then x.
 */
export function clusterSpawns(
  sightings: readonly SpawnSighting[],
  worldSize: number,
  radius = SPAWN_MERGE_RADIUS,
  minMatches = SPAWN_MIN_MATCHES,
): VehicleSpawn[] {
  interface Cluster {
    sx: number;
    sy: number;
    n: number;
    kinds: Map<VehicleKind, number>;
    matches: Set<string>;
  }
  const clusters: Cluster[] = [];
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx}:${cy}`;
  const r2 = radius * radius;
  for (const s of sightings) {
    if (!(s.x >= 0 && s.y >= 0 && s.x <= worldSize && s.y <= worldSize)) continue;
    const cx = Math.floor(s.x / radius);
    const cy = Math.floor(s.y / radius);
    let best = -1;
    let bestD = r2;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of grid.get(key(cx + dx, cy + dy)) ?? []) {
          const c = clusters[i];
          if (!c) continue;
          const d = (c.sx / c.n - s.x) ** 2 + (c.sy / c.n - s.y) ** 2;
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        }
    if (best === -1) {
      clusters.push({
        sx: s.x,
        sy: s.y,
        n: 1,
        kinds: new Map([[s.kind, 1]]),
        matches: new Set([s.matchId]),
      });
      const k = key(cx, cy);
      grid.set(k, [...(grid.get(k) ?? []), clusters.length - 1]);
    } else {
      const c = clusters[best];
      if (!c) continue;
      c.sx += s.x;
      c.sy += s.y;
      c.n += 1;
      c.kinds.set(s.kind, (c.kinds.get(s.kind) ?? 0) + 1);
      c.matches.add(s.matchId);
    }
  }
  const order = new Map(VEHICLE_KINDS.map((k, i) => [k, i]));
  return clusters
    .filter((c) => c.matches.size >= minMatches)
    .map((c) => {
      let kind: VehicleKind = 'car';
      let most = -1;
      for (const k of VEHICLE_KINDS) {
        const v = c.kinds.get(k) ?? 0;
        if (v > most) {
          most = v;
          kind = k;
        }
      }
      return { x: Math.round(c.sx / c.n), y: Math.round(c.sy / c.n), kind, seen: c.matches.size };
    })
    .sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0) || a.y - b.y || a.x - b.x);
}

/** telemetry `mapName` → our map, via the registry's `telemetryNames` */
export function mapIdForTelemetry(
  mapName: string,
  names: Record<MapId, readonly string[]>,
): MapId | null {
  for (const id of MAP_IDS) if (names[id].includes(mapName)) return id;
  return null;
}
