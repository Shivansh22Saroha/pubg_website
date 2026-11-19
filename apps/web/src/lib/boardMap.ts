import {
  CUSTOM_MAP_ID,
  customMapConfig,
  isPubgMap,
  MAPS,
  metresPerUnit,
  PUBG_METRES_PER_UNIT,
  tileWorldSize,
  type BoardMapId,
  type MapConfig,
  type MapId,
} from '@rotationlab/shared';
import { env } from '@/env';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');

/** a custom map as the map view needs it (room list item or public share payload) */
export interface CustomMapImage {
  name: string;
  widthM: number;
  imageUrl: string;
  previewUrl: string;
}

interface MapInfoBase {
  name: string;
  /** geometry for the CRS, grid and layers (custom maps: `customMapConfig`) */
  config: MapConfig;
  worldSize: number;
  /** world units spanned by the tile pyramid (CRS scale) */
  tileWorld: number;
  gridCells: number;
  maxNativeZoom: number;
  metresPerUnit: number;
  /** shown while the map loads, and behind thumbnails */
  backgroundUrl: string;
}

/**
 * Everything the map view needs about a board's map, PUBG or custom (FEATURES F20). Both use
 * the same coordinate square (`worldSize`); a custom map is one image over it (no tiles, no
 * labels variant, no vehicle spawns, no zone presets) with its own metres per world unit.
 */
export type BoardMapInfo =
  | (MapInfoBase & { kind: 'pubg'; mapId: MapId })
  | (MapInfoBase & {
      kind: 'custom';
      mapId: typeof CUSTOM_MAP_ID;
      imageUrl: string;
      widthM: number;
    });

function base(config: MapConfig, mpu: number, backgroundUrl: string): MapInfoBase {
  return {
    name: config.name,
    config,
    worldSize: config.worldSize,
    tileWorld: tileWorldSize(config),
    gridCells: config.gridCells,
    maxNativeZoom: config.maxNativeZoom,
    metresPerUnit: mpu,
    backgroundUrl,
  };
}

export function pubgMapInfo(mapId: MapId): BoardMapInfo {
  const config = MAPS[mapId];
  return {
    ...base(config, PUBG_METRES_PER_UNIT, `${tilesBase}/${config.lowres}`),
    kind: 'pubg',
    mapId,
  };
}

export function customMapInfo(map: CustomMapImage): BoardMapInfo {
  return {
    ...base(customMapConfig(map.name), metresPerUnit(map.widthM), map.previewUrl),
    kind: 'custom',
    mapId: CUSTOM_MAP_ID,
    imageUrl: map.imageUrl,
    widthM: map.widthM,
  };
}

/**
 * The board's map, or null while its custom map hasn't loaded (or is gone). `customMaps`:
 * the room's list, or the single map a share link carries.
 */
export function boardMapInfo(
  board: { mapId: BoardMapId; customMapId?: string | null },
  customMaps: readonly (CustomMapImage & { id?: string })[] | undefined,
): BoardMapInfo | null {
  if (isPubgMap(board.mapId)) return pubgMapInfo(board.mapId);
  const map =
    customMaps?.find((m) => m.id !== undefined && m.id === board.customMapId) ??
    (customMaps?.length === 1 && customMaps[0]?.id === undefined ? customMaps[0] : undefined);
  return map ? customMapInfo(map) : null;
}

/** "Erangel", or the custom map's name when known */
export function boardMapName(
  board: { mapId: BoardMapId; customMapId?: string | null },
  customMaps?: readonly { id: string; name: string }[],
): string {
  if (isPubgMap(board.mapId)) return MAPS[board.mapId].name;
  return customMaps?.find((m) => m.id === board.customMapId)?.name ?? 'Custom map';
}
