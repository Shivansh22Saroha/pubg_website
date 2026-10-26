import type { MapId } from './maps.js';

/** A zone-phase circle the Circle tool can place in one click (FEATURES F6, DRAW-8). */
export interface ZonePreset {
  label: string;
  radiusMetres: number;
}

/**
 * Per-map zone presets. Visual aids only. An empty list hides the "Zone presets" dropdown.
 */
// TODO(phase0): fill with verified BGMI/PUBG phase radii per map before release; until then
// the presets ship empty and the dropdown stays hidden.
export const ZONE_PRESETS: Record<MapId, readonly ZonePreset[]> = {
  erangel: [],
  miramar: [],
  rondo: [],
};
