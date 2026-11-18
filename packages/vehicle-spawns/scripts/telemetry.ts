import { vehicleKindOf, type SpawnSighting, type VehicleKind } from '@rotationlab/shared';

/** the subset of a PUBG `LogVehicleRide` telemetry event this tool reads */
interface RideEvent {
  _T: 'LogVehicleRide';
  character?: { location?: { x?: number; y?: number } };
  vehicle?: { vehicleType?: string; vehicleId?: string; vehicleUniqueId?: number };
}

function isRide(e: unknown): e is RideEvent {
  return typeof e === 'object' && e !== null && (e as { _T?: unknown })._T === 'LogVehicleRide';
}

/**
 * One sighting per vehicle per match: where it was *first* entered — a vehicle stays at its
 * spawn point until somebody gets in, so that spot is the spawn (the rider stands within a
 * metre or two of it). Telemetry names the model in `vehicleId` (`Dacia_A_01_v2_C`);
 * `vehicleType` is only the class (`WheeledVehicle`, `FloatingVehicle`), used as a fallback for
 * boats. Vehicles without a `vehicleUniqueId` can't be told apart and are skipped, as are kinds
 * that never spawn at fixed points (`vehicleKindOf` → null). Telemetry is untrusted input:
 * anything malformed is ignored, never thrown.
 */
export function firstRides(events: unknown, matchId: string): SpawnSighting[] {
  if (!Array.isArray(events)) return [];
  const seen = new Set<number>();
  const out: SpawnSighting[] = [];
  for (const e of events) {
    if (!isRide(e)) continue;
    const v = e.vehicle;
    const loc = e.character?.location;
    const uid = v?.vehicleUniqueId;
    if (typeof uid !== 'number' || seen.has(uid)) continue;
    seen.add(uid);
    if (typeof loc?.x !== 'number' || typeof loc.y !== 'number') continue;
    if (!Number.isFinite(loc.x) || !Number.isFinite(loc.y)) continue;
    const model = typeof v?.vehicleId === 'string' ? v.vehicleId : '';
    let kind: VehicleKind | null = model ? vehicleKindOf(model) : null;
    if (!model && v?.vehicleType === 'FloatingVehicle') kind = 'boat';
    if (!kind) continue;
    out.push({ x: Math.round(loc.x), y: Math.round(loc.y), kind, matchId });
  }
  return out;
}

/** match types whose vehicles spawn by the normal rules (no event / arcade modes) */
export const NORMAL_MATCH_TYPES: ReadonlySet<string> = new Set(['official', 'competitive']);
