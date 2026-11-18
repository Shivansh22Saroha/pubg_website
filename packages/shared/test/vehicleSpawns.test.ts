import { describe, expect, it } from 'vitest';
import {
  MAPS,
  MAP_IDS,
  SPAWN_MERGE_RADIUS,
  VehicleSpawnFileSchema,
  clusterSpawns,
  mapIdForTelemetry,
  vehicleKindOf,
  type SpawnSighting,
} from '../src/index.js';

const W = 816_000;
const names = Object.fromEntries(MAP_IDS.map((id) => [id, MAPS[id].telemetryNames])) as Record<
  (typeof MAP_IDS)[number],
  readonly string[]
>;

describe('vehicle kinds', () => {
  it('sorts PUBG vehicle types into car / bike / boat / glider', () => {
    expect(vehicleKindOf('Dacia_A_01_v2_C')).toBe('car');
    expect(vehicleKindOf('Uaz_C_01_C')).toBe('car');
    expect(vehicleKindOf('BP_Mirado_A_02_C')).toBe('car');
    expect(vehicleKindOf('BP_Motorbike_04_SideCar_C')).toBe('bike');
    expect(vehicleKindOf('BP_Dirtbike_C')).toBe('bike');
    expect(vehicleKindOf('BP_Scooter_01_A_C')).toBe('bike');
    expect(vehicleKindOf('BP_ATV_C')).toBe('bike');
    expect(vehicleKindOf('Boat_PG117_C')).toBe('boat');
    expect(vehicleKindOf('AquaRail_A_01_C')).toBe('boat');
    expect(vehicleKindOf('AirBoat_V2_C')).toBe('boat');
    expect(vehicleKindOf('BP_Motorglider_C')).toBe('glider');
  });

  it('skips vehicles that never spawn at fixed points', () => {
    for (const t of [
      'BP_BRDM_C',
      'BP_DO_Line_Train_Merged_C',
      'BP_KillTruck_C',
      'BP_LootTruck_C',
      'BP_Food_Truck_C',
      'BP_EmergencyPickupVehicle_C',
    ])
      expect(vehicleKindOf(t), t).toBeNull();
  });

  it('maps telemetry map names through the registry', () => {
    expect(mapIdForTelemetry('Baltic_Main', names)).toBe('erangel');
    expect(mapIdForTelemetry('Erangel_Main', names)).toBe('erangel');
    expect(mapIdForTelemetry('Desert_Main', names)).toBe('miramar');
    expect(mapIdForTelemetry('Neon_Main', names)).toBe('rondo');
    expect(mapIdForTelemetry('Savage_Main', names)).toBeNull();
  });
});

describe('clustering first-ride sightings into spawn points', () => {
  const s = (x: number, y: number, matchId: string, kind: SpawnSighting['kind'] = 'car') => ({
    x,
    y,
    kind,
    matchId,
  });

  it('merges sightings within the radius into one point at their centroid', () => {
    const out = clusterSpawns(
      [s(100_000, 200_000, 'm1'), s(100_400, 200_300, 'm2'), s(99_800, 199_900, 'm3')],
      W,
    );
    expect(out).toEqual([{ x: 100_067, y: 200_067, kind: 'car', seen: 3 }]);
  });

  it('keeps points further apart than the radius separate', () => {
    const out = clusterSpawns(
      [
        s(100_000, 200_000, 'm1'),
        s(100_000, 200_000, 'm2'),
        s(100_000 + SPAWN_MERGE_RADIUS * 3, 200_000, 'm1'),
        s(100_000 + SPAWN_MERGE_RADIUS * 3, 200_000, 'm2'),
      ],
      W,
    );
    expect(out).toHaveLength(2);
  });

  it('drops points seen in only one match (likely a moved vehicle) and counts matches, not rides', () => {
    const out = clusterSpawns(
      [
        s(300_000, 300_000, 'm1'),
        s(300_100, 300_000, 'm1'),
        s(500_000, 500_000, 'm1'),
        s(500_000, 500_000, 'm2'),
      ],
      W,
    );
    expect(out).toEqual([{ x: 500_000, y: 500_000, kind: 'car', seen: 2 }]);
  });

  it('takes the most common kind and ignores sightings off the map', () => {
    const out = clusterSpawns(
      [
        s(10_000, 10_000, 'm1', 'boat'),
        s(10_000, 10_000, 'm2', 'boat'),
        s(10_000, 10_000, 'm3', 'car'),
        s(-5, 10, 'm1'),
        s(W + 1, 10, 'm2'),
      ],
      W,
    );
    expect(out).toEqual([{ x: 10_000, y: 10_000, kind: 'boat', seen: 3 }]);
  });

  it('the file format is strict', () => {
    const ok = {
      mapId: 'erangel',
      source: 'pubg-api',
      shard: 'steam',
      generatedAt: '2026-11-18T12:00:00.000Z',
      matches: 120,
      spawns: [{ x: 1, y: 2, kind: 'car', seen: 2 }],
    };
    expect(VehicleSpawnFileSchema.parse(ok).spawns).toHaveLength(1);
    expect(() => VehicleSpawnFileSchema.parse({ ...ok, mapId: 'vikendi' })).toThrow();
    expect(() =>
      VehicleSpawnFileSchema.parse({ ...ok, spawns: [{ x: 1.5, y: 2, kind: 'car', seen: 2 }] }),
    ).toThrow();
    expect(() =>
      VehicleSpawnFileSchema.parse({ ...ok, spawns: [{ x: 1, y: 2, kind: 'tank', seen: 2 }] }),
    ).toThrow();
  });
});
