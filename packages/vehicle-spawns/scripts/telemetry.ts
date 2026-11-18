import { vehicleKindOf, type SpawnSighting, type VehicleKind } from '@rotationlab/shared';

/** the subset of a PUBG `LogVehicleRide` telemetry event this tool reads */
interface RideEvent {
  _T: 'LogVehicleRide';
  character?: { location?: { x?: number; y?: number } };
  vehicle?: { vehicleType?: string; vehicleId?: string; vehicleUniqueId?: number | string };
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
  const seen = new Set<number | string>();
  const out: SpawnSighting[] = [];
  for (const e of events) {
    if (!isRide(e)) continue;
    const v = e.vehicle;
    const loc = e.character?.location;
    const uid = v?.vehicleUniqueId;
    if ((typeof uid !== 'number' && typeof uid !== 'string') || uid === '' || seen.has(uid))
      continue;
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

/** shape of a value without its content: `{x:number,name:string}` — for logs, never values */
function shapeOf(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v === null || typeof v !== 'object') return typeof v;
  if (depth >= 1) return 'object';
  return `{${Object.entries(v)
    .map(([k, x]) => `${k}:${shapeOf(x, depth + 1)}`)
    .join(',')}}`;
}

/**
 * A one-line description of a telemetry file for the workflow log: event counts for
 * vehicle-related event types and the *field names and types* of the first ride event (no
 * player names or other values), so a format change shows up without exposing match data.
 */
export function describeTelemetry(events: unknown): string {
  if (!Array.isArray(events)) return `not an array: ${shapeOf(events)}`;
  const counts = new Map<string, number>();
  for (const e of events) {
    const t = typeof e === 'object' && e !== null ? (e as { _T?: unknown })._T : undefined;
    if (typeof t === 'string' && /vehicle/i.test(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ride = events.find(isRide);
  const sample = ride
    ? ` ride: vehicle=${shapeOf(ride.vehicle)} character=${shapeOf(ride.character)} model=${
        typeof ride.vehicle?.vehicleId === 'string' ? ride.vehicle.vehicleId.slice(0, 40) : '-'
      }`
    : ' no LogVehicleRide';
  return `${events.length} events; ${JSON.stringify(Object.fromEntries(counts))};${sample}`;
}
