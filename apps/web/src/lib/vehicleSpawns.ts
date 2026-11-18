'use client';

import {
  VEHICLE_KINDS,
  VehicleSpawnFileSchema,
  type MapId,
  type VehicleKind,
  type VehicleSpawnFile,
} from '@rotationlab/shared';
import { useEffect, useState } from 'react';
import { prefKeys, readPref, writePref } from '@/lib/prefs';

/**
 * Vehicle spawn data (`public/spawns/<mapId>.json`, built by packages/vehicle-spawns from the
 * PUBG API). Static files on our own origin, validated like any other input; a missing file
 * means "no data for this map yet", never an error screen.
 */
export type SpawnData =
  { status: 'loading' } | { status: 'none' } | { status: 'ready'; file: VehicleSpawnFile };

const cache = new Map<MapId, Promise<SpawnData>>();

export function loadSpawns(mapId: MapId): Promise<SpawnData> {
  let p = cache.get(mapId);
  if (!p) {
    p = fetch(`/spawns/${mapId}.json`, { credentials: 'omit' })
      .then(async (res): Promise<SpawnData> => {
        if (!res.ok) return { status: 'none' };
        const parsed = VehicleSpawnFileSchema.safeParse(await res.json());
        if (!parsed.success || parsed.data.mapId !== mapId) return { status: 'none' };
        return { status: 'ready', file: parsed.data };
      })
      .catch((): SpawnData => {
        cache.delete(mapId); // a network blip: try again next time
        return { status: 'none' };
      });
    cache.set(mapId, p);
  }
  return p;
}

/** loads only once the layer is switched on (most visits never need the file) */
export function useSpawnData(mapId: MapId, enabled: boolean): SpawnData {
  const [result, setResult] = useState<{ mapId: MapId; data: SpawnData } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadSpawns(mapId).then((data) => {
      if (alive) setResult({ mapId, data });
    });
    return () => {
      alive = false;
    };
  }, [mapId, enabled]);
  // a result for another map (board switched) counts as still loading
  return result && result.mapId === mapId ? result.data : { status: 'loading' };
}

export interface VehiclePrefs {
  on: boolean;
  kinds: VehicleKind[];
}

const DEFAULT_PREFS: VehiclePrefs = { on: false, kinds: [...VEHICLE_KINDS] };

/** per device, like the minimap's collapsed state (lib/prefs: storage may be missing) */
export function readVehiclePrefs(): VehiclePrefs {
  try {
    const raw: unknown = JSON.parse(readPref(prefKeys.vehicles) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
    const r = raw as Partial<Record<keyof VehiclePrefs, unknown>>;
    const kinds = Array.isArray(r.kinds)
      ? VEHICLE_KINDS.filter((k) => (r.kinds as unknown[]).includes(k))
      : DEFAULT_PREFS.kinds;
    return { on: r.on === true, kinds };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useVehiclePrefs() {
  // like the minimap: the map renders client-side only, so reading storage here is safe
  const [prefs, setPrefs] = useState<VehiclePrefs>(readVehiclePrefs);
  const update = (next: VehiclePrefs) => {
    setPrefs(next);
    writePref(prefKeys.vehicles, JSON.stringify(next));
  };
  return [prefs, update] as const;
}
