'use client';

import { RECALL_MAP_IDS, RecallFileSchema, type MapId, type RecallFile } from '@rotationlab/shared';
import { useEffect, useState } from 'react';
import { prefKeys, readPref, writePref } from '@/lib/prefs';

/**
 * Recall tower data (`public/recalls/<mapId>.json`, built by packages/vehicle-spawns from the
 * PUBG API). Static files on our own origin, validated like any other input; a missing file
 * means "this map has no recall data" — the toggle is simply not shown. Only maps listed in
 * `RECALL_MAP_IDS` are requested.
 */
export type RecallData =
  { status: 'loading' } | { status: 'none' } | { status: 'ready'; file: RecallFile };

const cache = new Map<MapId, Promise<RecallData>>();

export function loadRecalls(mapId: MapId): Promise<RecallData> {
  // only maps with a published file are requested (no 404s for the rest)
  if (!RECALL_MAP_IDS.includes(mapId)) return Promise.resolve({ status: 'none' });
  let p = cache.get(mapId);
  if (!p) {
    p = fetch(`/recalls/${mapId}.json`, { credentials: 'omit' })
      .then(async (res): Promise<RecallData> => {
        if (!res.ok) return { status: 'none' };
        const parsed = RecallFileSchema.safeParse(await res.json());
        if (!parsed.success || parsed.data.mapId !== mapId || parsed.data.towers.length === 0)
          return { status: 'none' };
        return { status: 'ready', file: parsed.data };
      })
      .catch((): RecallData => {
        cache.delete(mapId); // a network blip: try again next time
        return { status: 'none' };
      });
    cache.set(mapId, p);
  }
  return p;
}

/** the file is tiny, so it's loaded whenever a PUBG map is open: it decides if the toggle shows */
export function useRecallData(mapId: MapId, enabled: boolean): RecallData {
  const [result, setResult] = useState<{ mapId: MapId; data: RecallData } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadRecalls(mapId).then((data) => {
      if (alive) setResult({ mapId, data });
    });
    return () => {
      alive = false;
    };
  }, [mapId, enabled]);
  return result && result.mapId === mapId ? result.data : { status: 'loading' };
}

/** shown by default; switching it off is remembered per device (lib/prefs) */
export function readRecallsOn(): boolean {
  return readPref(prefKeys.recalls) !== 'off';
}

export function useRecallsOn() {
  // the map renders client-side only, so reading storage here is safe
  const [on, setOn] = useState<boolean>(readRecallsOn);
  const update = (next: boolean) => {
    setOn(next);
    writePref(prefKeys.recalls, next ? 'on' : 'off');
  };
  return [on, update] as const;
}
