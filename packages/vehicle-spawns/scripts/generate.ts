/**
 * Vehicle spawns from PUBG's official API (see packages/shared/src/vehicleSpawns.ts).
 *
 *   PUBG_API_KEY=… pnpm --filter vehicle-spawns generate
 *
 * 1. GET /shards/<shard>/samples — a random sample of recent match ids (one request; that
 *    endpoint is rate-limited to 10 per minute, /matches is not).
 * 2. For each match: GET /matches/<id>, keep normal matches on our maps, download telemetry.
 * 3. First ride of every vehicle → sightings → clusterSpawns → apps/web/public/spawns/<map>.json
 *
 * Env: PUBG_API_KEY (required), PUBG_SHARD (default steam), MATCHES_PER_MAP (default 250),
 * OUT_DIR (default ../../apps/web/public/spawns). The key is only sent to api.pubg.com — the
 * telemetry CDN needs none — and is never logged.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAPS,
  MAP_IDS,
  VehicleSpawnFileSchema,
  clusterSpawns,
  mapIdForTelemetry,
  type MapId,
  type SpawnSighting,
} from '@rotationlab/shared';
import { describeTelemetry, firstRides, NORMAL_MATCH_TYPES } from './telemetry.js';

const API = 'https://api.pubg.com';
const KEY = process.env.PUBG_API_KEY ?? '';
const SHARD = process.env.PUBG_SHARD ?? 'steam';
const PER_MAP = Number(process.env.MATCHES_PER_MAP ?? 250);
const PKG_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = path.resolve(PKG_DIR, process.env.OUT_DIR ?? '../../apps/web/public/spawns');
const CONCURRENCY = 4;

if (!KEY) {
  console.error('PUBG_API_KEY is not set');
  process.exit(1);
}
if (!/^[a-z-]{2,20}$/.test(SHARD)) throw new Error(`bad PUBG_SHARD ${SHARD}`);

async function api<T>(p: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${p}`, {
      headers: { authorization: `Bearer ${KEY}`, accept: 'application/vnd.api+json' },
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }
    if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

interface Samples {
  data: { relationships: { matches: { data: { id: string }[] } } };
}
interface Match {
  data: { attributes: { mapName: string; matchType: string; gameMode: string } };
  included?: { type: string; attributes?: { URL?: string } }[];
}

const telemetryNames = Object.fromEntries(
  MAP_IDS.map((id) => [id, MAPS[id].telemetryNames]),
) as Record<MapId, readonly string[]>;

async function main() {
  const samples = await api<Samples>(`/shards/${SHARD}/samples`);
  const ids = samples.data.relationships.matches.data
    .map((m) => m.id)
    .filter((id) => /^[0-9a-f-]{36}$/.test(id));
  console.log(`${ids.length} sampled matches on ${SHARD}`);

  const sightings: Record<MapId, SpawnSighting[]> = { erangel: [], miramar: [], rondo: [] };
  const used: Record<MapId, number> = { erangel: 0, miramar: 0, rondo: 0 };
  const full = () => MAP_IDS.every((m) => used[m] >= PER_MAP);
  let next = 0;
  let failures = 0;
  const described = new Set<MapId>();

  async function worker() {
    while (next < ids.length && !full()) {
      const id = ids[next++];
      if (!id) break;
      try {
        const m = await api<Match>(`/shards/${SHARD}/matches/${id}`);
        const { mapName, matchType } = m.data.attributes;
        const mapId = mapIdForTelemetry(mapName, telemetryNames);
        if (!mapId || !NORMAL_MATCH_TYPES.has(matchType) || used[mapId] >= PER_MAP) continue;
        const url = m.included?.find((i) => i.type === 'asset')?.attributes?.URL;
        if (!url || !url.startsWith('https://telemetry-cdn.pubg.com/')) continue;
        used[mapId]++; // reserve before the slow download so workers don't overshoot
        const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
        if (!res.ok) throw new Error(`telemetry HTTP ${res.status}`);
        const events: unknown = await res.json();
        if (!described.has(mapId)) {
          described.add(mapId);
          console.log(`${mapId} telemetry sample: ${describeTelemetry(events)}`);
        }
        sightings[mapId].push(...firstRides(events, id));
      } catch (err) {
        failures++;
        console.warn(`match ${id}: ${(err as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await mkdir(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  for (const mapId of MAP_IDS) {
    if (used[mapId] === 0) {
      console.log(`${mapId}: no matches in this sample — file left as it was`);
      continue;
    }
    const spawns = clusterSpawns(sightings[mapId], MAPS[mapId].worldSize);
    if (spawns.length === 0) {
      // never replace real data with an empty file (a telemetry format change, a bad sample)
      console.log(
        `${mapId}: ${used[mapId]} matches, ${sightings[mapId].length} first rides → 0 spawn points — file left as it was`,
      );
      continue;
    }
    const file = VehicleSpawnFileSchema.parse({
      mapId,
      source: 'pubg-api',
      shard: SHARD,
      generatedAt,
      matches: used[mapId],
      spawns,
    });
    await writeFile(path.join(OUT_DIR, `${mapId}.json`), `${JSON.stringify(file)}\n`);
    const byKind = spawns.reduce<Record<string, number>>(
      (a, s) => ({ ...a, [s.kind]: (a[s.kind] ?? 0) + 1 }),
      {},
    );
    console.log(
      `${mapId}: ${used[mapId]} matches, ${sightings[mapId].length} first rides → ${spawns.length} spawn points ${JSON.stringify(byKind)}`,
    );
  }
  if (failures) console.log(`${failures} matches failed (skipped)`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
