'use client';

import {
  DemoBoardsResponseSchema,
  MAP_IDS,
  type BoardMapId,
  type DemoBoard,
  type Layer,
} from '@rotationlab/shared';
import { useQuery } from '@tanstack/react-query';
import type { ViewElement } from '@/stores/boardModel';
import { api } from './api';
import { pubgMapInfo, type BoardMapInfo } from './boardMap';

/** What /explore shows per map: the demo board for it, or the bare map when none is set up. */
export interface ExploreBoard {
  mapId: BoardMapId;
  /** the resolved map (a share link's board may be on a custom map, F20) */
  map: BoardMapInfo;
  name: string;
  elements: Record<string, ViewElement>;
  layers: Layer[];
}

/**
 * FEATURES F13: one entry per map in map order — the first demo board of each map, or an
 * empty board (bare map, labels / grid / measure still work) when `DEMO_BOARD_IDS` has none.
 */
export function exploreBoards(items: readonly DemoBoard[]): ExploreBoard[] {
  return MAP_IDS.map((mapId) => {
    const item = items.find((i) => i.board.mapId === mapId);
    const map = pubgMapInfo(mapId);
    if (!item) return { mapId, map, name: '', elements: {}, layers: [] };
    return {
      mapId,
      map,
      name: item.board.name,
      layers: item.layers,
      elements: Object.fromEntries(item.elements.map((e) => [e.id, e])),
    };
  });
}

/** Public, cached 5 min by the server too; no session needed (and none is refreshed). */
export function useDemoBoards() {
  return useQuery({
    queryKey: ['public', 'demo-boards'],
    queryFn: async ({ signal }) =>
      (await api('/public/demo-boards', { schema: DemoBoardsResponseSchema, signal })).items,
    staleTime: 5 * 60_000,
  });
}
