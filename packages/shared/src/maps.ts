/**
 * Phase 0 map constants. The full registry (tile variants, maxNativeZoom from the tiles
 * manifest, telemetry names) is completed in Phase 2 — see ARCHITECTURE §5.2.
 *
 * All coordinates are PUBG world units (centimetres), origin top-left, x → east, y → south.
 */

export const MAP_IDS = ['erangel', 'miramar', 'rondo'] as const;
export type MapId = (typeof MAP_IDS)[number];

/** 8 × 8 km = 816 000 cm per side. */
export const DEFAULT_WORLD_SIZE = 816_000;

export const WORLD_SIZE: Record<MapId, number> = {
  erangel: DEFAULT_WORLD_SIZE,
  miramar: DEFAULT_WORLD_SIZE,
  // TODO(phase0): verify Rondo world size is 816 000 cm (8×8 km) before release.
  rondo: DEFAULT_WORLD_SIZE,
};

export const GRID_CELLS = 8;

// TODO(phase0): verify grid letter scheme (columns A–H, rows I–P) against the in-game map.
export const GRID_COLUMN_LETTERS = 'ABCDEFGH';
export const GRID_ROW_LETTERS = 'IJKLMNOP';

/** Zone phase radii in world units, per map. `null` = presets hidden in the UI. */
// TODO(phase0): collect verified zone phase radii per map; until then presets ship disabled.
export const ZONE_PRESETS: Record<MapId, readonly number[] | null> = {
  erangel: null,
  miramar: null,
  rondo: null,
};

/** Travel-time estimates in m/s (ARCHITECTURE §5.5) — labelled "approx." in the UI. */
export const SPEEDS = { foot: 6, vehicle: 22 } as const;
