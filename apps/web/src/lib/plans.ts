import {
  drawnPoints,
  measure,
  type Layer as BoardLayer,
  type MeasureSummary,
  type Pt,
} from '@rotationlab/shared';
import type { ViewElement } from '@/stores/boardModel';

/**
 * Plan tools (FEATURES F24): route options, plan replay and the compass bearing — all derived
 * from the board's existing elements, nothing new is stored.
 */

/** element types that count as a route: lines, arrows and pen paths */
export const ROUTE_TYPES = new Set<ViewElement['type']>(['LINE', 'ARROW', 'STROKE']);

/**
 * When an element was created. Ids are UUIDv7 (made by the creating client, or the server for
 * seeds), whose first 48 bits are the creation time in ms. Anything else → null.
 */
export function createdAtOf(id: string): number | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    return null;
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/** creation order: by creation time, then by seq (non-v7 ids), then by id */
export function byCreation(a: ViewElement, b: ViewElement): number {
  const ta = createdAtOf(a.id) ?? Number.MAX_SAFE_INTEGER;
  const tb = createdAtOf(b.id) ?? Number.MAX_SAFE_INTEGER;
  return ta - tb || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Compass bearing from `a` to `b` in whole degrees, like the in-game compass: 0 = north (up,
 * y = 0), clockwise, 0–359. World y grows downward (south).
 */
export function bearingDeg(a: Pt, b: Pt): number {
  const deg = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
  return Math.round((deg + 360) % 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** the nearest of the 8 compass points */
export function compassPoint(deg: number): (typeof POINTS)[number] {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N';
}

/** "Plan A" … "Plan Z", then "Plan 27" … */
export function planName(index: number): string {
  return index < 26 ? `Plan ${String.fromCharCode(65 + index)}` : `Plan ${index + 1}`;
}

export interface RouteOption {
  id: string;
  name: string;
  type: 'LINE' | 'ARROW' | 'STROKE';
  color: string;
  layerName: string;
  createdBy: string | null;
  points: readonly Pt[];
  summary: MeasureSummary;
  /** start → end */
  bearing: number;
}

/**
 * The board's route options: every line, arrow and pen path on a visible layer, oldest first,
 * named Plan A, B, C… Points follow what's drawn (a curved arrow's curve).
 */
export function routesOf(
  elements: Readonly<Record<string, ViewElement>>,
  layers: readonly BoardLayer[],
  metresPerUnit: number,
  hiddenLayers: Readonly<Record<string, boolean>> = {},
): RouteOption[] {
  const layerById = new Map(layers.map((l) => [l.id, l]));
  return Object.values(elements)
    .filter((el) => {
      const layer = layerById.get(el.layerId);
      return ROUTE_TYPES.has(el.type) && layer?.visible === true && !hiddenLayers[el.layerId];
    })
    .sort(byCreation)
    .flatMap((el) => {
      const points = drawnPoints(el);
      const first = points[0];
      const last = points.at(-1);
      if (!first || !last || points.length < 2) return [];
      return [{ el, points, first, last }];
    })
    .map(({ el, points, first, last }, i) => ({
      id: el.id,
      name: planName(i),
      type: el.type as RouteOption['type'],
      color: el.style.color,
      layerName: layerById.get(el.layerId)?.name ?? '',
      createdBy: el.createdBy,
      points,
      summary: measure(points, metresPerUnit),
      bearing: bearingDeg(first, last),
    }));
}

/** what a replay step says someone did */
export function describeElement(el: Pick<ViewElement, 'type' | 'props'>, markerLabel?: string) {
  switch (el.type) {
    case 'LINE':
      return 'drew a line';
    case 'ARROW':
      return 'drew an arrow';
    case 'STROKE':
      return 'drew a path';
    case 'CIRCLE':
      return 'drew a circle';
    case 'POLYGON':
      return 'marked an area';
    case 'TEXT':
      return 'added a note';
    case 'MARKER':
      return markerLabel ? `marked ${markerLabel.toLowerCase()}` : 'placed a marker';
  }
}

/** a replay step's time, relative to the first element: "0:42", "12:05", or "+2 d" */
export function formatOffset(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 86_400) return `+${Math.floor(s / 86_400)} d`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Replay pacing: the whole board plays in about 20 s, one element every 0.7 s at most and
 * 40 ms at least (big boards reveal several per tick).
 */
export function replayPace(total: number): { intervalMs: number; perTick: number } {
  const target = 20_000;
  const intervalMs = Math.max(40, Math.min(700, total > 0 ? target / total : 700));
  const perTick = Math.max(1, Math.round((total * intervalMs) / target));
  return { intervalMs, perTick };
}
