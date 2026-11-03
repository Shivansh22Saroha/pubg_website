/**
 * Map registry (ARCHITECTURE §5.2). Tile values come from packages/map-tiles/out/manifest.json
 * (`pnpm --filter map-tiles run build`). Adding a map = run the tile script + add one entry here
 * + extend the `MapId` DB enum.
 *
 * All coordinates are PUBG world units (centimetres), origin top-left, x → east, y → south.
 */

export const MAP_IDS = ['erangel', 'miramar', 'rondo'] as const;
export type MapId = (typeof MAP_IDS)[number];

export function isMapId(value: string): value is MapId {
  return (MAP_IDS as readonly string[]).includes(value);
}

/** 816 000 cm per side. PUBG calls these "8×8 km" maps; strictly it is 8.16 km. */
export const DEFAULT_WORLD_SIZE = 816_000;

export const GRID_CELLS = 8;

// TODO(phase0): verify grid letter scheme (columns A–H, rows I–P) against the in-game map.
export const GRID_COLUMN_LETTERS = 'ABCDEFGH';
export const GRID_ROW_LETTERS = 'IJKLMNOP';

export const TILE_SIZE = 256;

export interface MapConfig {
  id: MapId;
  name: string;
  telemetryNames: readonly string[];
  /** world units (cm) per side */
  worldSize: number;
  gridCells: number;
  tileSize: number;
  /** source art side in px (from manifest) */
  sourceSize: number;
  /** tile pyramid side in px — sourceSize padded right/bottom up to 256·2^maxNativeZoom */
  paddedSize: number;
  maxNativeZoom: number;
  /** paths relative to the tiles base URL */
  variants: { labels: string; clean: string };
  lowres: string;
  preview: string;
  /** 512 px WebP for dashboard room cards */
  card: string;
  thumbnail: string;
}

function entry(
  id: MapId,
  name: string,
  telemetryNames: readonly string[],
  tiles: { sourceSize: number; paddedSize: number; maxNativeZoom: number },
  worldSize = DEFAULT_WORLD_SIZE,
): MapConfig {
  return {
    id,
    name,
    telemetryNames,
    worldSize,
    gridCells: GRID_CELLS,
    tileSize: TILE_SIZE,
    ...tiles,
    variants: { labels: `${id}/labels`, clean: `${id}/clean` },
    lowres: `${id}/lowres.jpg`,
    preview: `${id}/preview.jpg`,
    card: `${id}/card.webp`,
    thumbnail: `${id}/thumb.jpg`,
  };
}

// Tile values: manifest.json from pubg/api-assets@32b13b5 (see CHANGELOG, Phase 2).
export const MAPS: Readonly<Record<MapId, MapConfig>> = {
  erangel: entry('erangel', 'Erangel', ['Erangel_Main', 'Baltic_Main'], {
    sourceSize: 8192,
    paddedSize: 8192,
    maxNativeZoom: 5,
  }),
  miramar: entry('miramar', 'Miramar', ['Desert_Main'], {
    sourceSize: 8192,
    paddedSize: 8192,
    maxNativeZoom: 5,
  }),
  rondo: entry(
    'rondo',
    'Rondo',
    ['Neon_Main'],
    { sourceSize: 8192, paddedSize: 8192, maxNativeZoom: 5 },
    // TODO(phase0): verify Rondo world size is 816 000 cm (8×8 km) before release.
    DEFAULT_WORLD_SIZE,
  ),
};

/** World units spanned by the whole tile pyramid (> worldSize only when the art was padded). */
export function tileWorldSize(map: Pick<MapConfig, 'worldSize' | 'sourceSize' | 'paddedSize'>) {
  return (map.worldSize * map.paddedSize) / map.sourceSize;
}

/** Travel-time estimates in m/s (ARCHITECTURE §5.5) — labelled "approx." in the UI. */
export const SPEEDS = { foot: 6, vehicle: 22 } as const;
