import {
  vehicleKindOf,
  type RecallSighting,
  type SpawnSighting,
  type VehicleKind,
} from '@rotationlab/shared';

type Loc = { x?: unknown; y?: unknown };

/** the subset of PUBG `LogVehicleRide` / `LogVehicleLeave` telemetry events this tool reads */
interface VehicleEvent {
  _T: 'LogVehicleRide' | 'LogVehicleLeave';
  character?: { location?: Loc };
  vehicle?: {
    vehicleType?: unknown;
    vehicleId?: unknown;
    vehicleUniqueId?: unknown;
    healthPercent?: unknown;
    location?: Loc;
  };
}

function isVehicleEvent(e: unknown): e is VehicleEvent {
  if (typeof e !== 'object' || e === null) return false;
  const t = (e as { _T?: unknown })._T;
  return t === 'LogVehicleRide' || t === 'LogVehicleLeave';
}

function isRide(e: unknown): e is VehicleEvent {
  return isVehicleEvent(e) && e._T === 'LogVehicleRide';
}

function point(l: Loc | undefined): { x: number; y: number } | null {
  if (!l || typeof l.x !== 'number' || typeof l.y !== 'number') return null;
  if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
  return { x: l.x, y: l.y };
}

/** a vehicle re-entered within this distance of where one of the same model was left (cm) */
export const REENTRY_RADIUS = 600;

const near = (list: { x: number; y: number }[] | undefined, p: { x: number; y: number }) =>
  !!list?.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= REENTRY_RADIUS);

/**
 * One sighting per vehicle per match: where it was *first* entered — a vehicle stays at its
 * spawn point until somebody gets in, so that spot is the spawn. Telemetry names the model in
 * `vehicleId` (`Dacia_A_01_v2_C`); `vehicleType` is only the class (`WheeledVehicle`,
 * `FloatingVehicle`), used as a fallback for boats. The vehicle's own `location` is used (the
 * rider's when absent).
 *
 * Current telemetry has no per-vehicle id, so a first ride is told apart by elimination: the
 * vehicle is at full health, no vehicle of the same model was left within `REENTRY_RADIUS` of
 * that spot earlier in the match (a re-entry), and none was already entered there (a
 * squadmate getting in). Older files with `vehicleUniqueId` use the id instead. Kinds that
 * never spawn at fixed points (`vehicleKindOf` → null) are skipped. Telemetry is untrusted
 * input: anything malformed is ignored, never thrown. Mistakes left over (a pushed vehicle)
 * land in one match only and are dropped by clustering's minimum-matches rule.
 */
export function firstRides(events: unknown, matchId: string): SpawnSighting[] {
  if (!Array.isArray(events)) return [];
  const seenIds = new Set<number | string>();
  const left = new Map<string, { x: number; y: number }[]>();
  const entered = new Map<string, { x: number; y: number }[]>();
  const out: SpawnSighting[] = [];
  for (const e of events) {
    if (!isVehicleEvent(e)) continue;
    const v = e.vehicle;
    const p = point(v?.location) ?? point(e.character?.location);
    if (!p) continue;
    const model = typeof v?.vehicleId === 'string' ? v.vehicleId : '';
    const key = model || (typeof v?.vehicleType === 'string' ? v.vehicleType : '');
    if (e._T === 'LogVehicleLeave') {
      left.set(key, [...(left.get(key) ?? []), p]);
      continue;
    }
    const uid = v?.vehicleUniqueId;
    if (typeof uid === 'number' || (typeof uid === 'string' && uid !== '')) {
      if (seenIds.has(uid)) continue;
      seenIds.add(uid);
    } else {
      if (typeof v?.healthPercent === 'number' && v.healthPercent < 99) continue;
      if (near(left.get(key), p) || near(entered.get(key), p)) continue;
      entered.set(key, [...(entered.get(key) ?? []), p]);
    }
    let kind: VehicleKind | null = model ? vehicleKindOf(model) : null;
    if (!model && v?.vehicleType === 'FloatingVehicle') kind = 'boat';
    if (!kind) continue;
    out.push({ x: Math.round(p.x), y: Math.round(p.y), kind, matchId });
  }
  return out;
}

/**
 * Recall towers: a Blue Chip (`Item_Bluechip_C`) can only be used at a recall tower, so every
 * `LogItemUse` of one puts the player at a tower — one sighting per use. (`Item_Special_Bluechip_C`
 * in equip events is the chip being carried, not a use.) Untrusted input: malformed events are
 * ignored, never thrown.
 */
export function recallUses(events: unknown, matchId: string): RecallSighting[] {
  if (!Array.isArray(events)) return [];
  const out: RecallSighting[] = [];
  for (const e of events) {
    if (typeof e !== 'object' || e === null) continue;
    const ev = e as { _T?: unknown; item?: { itemId?: unknown }; character?: { location?: Loc } };
    if (ev._T !== 'LogItemUse' || ev.item?.itemId !== 'Item_Bluechip_C') continue;
    const p = point(ev.character?.location);
    if (p) out.push({ x: Math.round(p.x), y: Math.round(p.y), matchId });
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
