/**
 * Pure world-unit math (ARCHITECTURE §5). World units are PUBG centimetres, origin top-left,
 * x → east, y → south, 0…worldSize. Leaflet-specific parts live in apps/web/src/lib/coords.ts.
 */
import { GRID_CELLS, GRID_COLUMN_LETTERS, GRID_ROW_LETTERS, SPEEDS } from './maps.js';

export type Pt = readonly [x: number, y: number];

/** Number of minor (≈100 m) subdivisions per major grid square. */
export const SUB_CELLS = 10;

export interface GridRef {
  col: string;
  row: string;
  /** 0–9 sub-square within the major square, along x and y */
  sub: readonly [number, number];
  /** e.g. "F-M" */
  square: string;
  /** e.g. "F-M 4,7" */
  label: string;
}

export function isInWorld([x, y]: Pt, worldSize: number): boolean {
  return x >= 0 && y >= 0 && x <= worldSize && y <= worldSize;
}

/** Index of the cell containing `v`; the far edge (v === size) belongs to the last cell. */
function cellIndex(v: number, size: number, cells: number): number {
  return Math.min(cells - 1, Math.floor(v / (size / cells)));
}

/** Grid reference for a world point, or null when it is outside the map. */
export function gridRef(pt: Pt, worldSize: number): GridRef | null {
  if (!isInWorld(pt, worldSize)) return null;
  const [x, y] = pt;
  const ci = cellIndex(x, worldSize, GRID_CELLS);
  const ri = cellIndex(y, worldSize, GRID_CELLS);
  const cell = worldSize / GRID_CELLS;
  const sx = cellIndex(x - ci * cell, cell, SUB_CELLS);
  const sy = cellIndex(y - ri * cell, cell, SUB_CELLS);
  const col = GRID_COLUMN_LETTERS.charAt(ci);
  const row = GRID_ROW_LETTERS.charAt(ri);
  const square = `${col}-${row}`;
  return { col, row, sub: [sx, sy], square, label: `${square} ${sx},${sy}` };
}

/** Positions (world units) of grid lines from 0 to worldSize inclusive. */
export function gridLines(worldSize: number, divisions: number): number[] {
  return Array.from({ length: divisions + 1 }, (_, i) => (worldSize * i) / divisions);
}

/** Straight-line distance between two world points, in metres. */
export function distanceMetres(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 100;
}

/** Total length of a polyline, in metres. */
export function pathLengthMetres(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += distanceMetres(a, b);
  }
  return total;
}

export type TravelMode = keyof typeof SPEEDS;

/** Estimated travel time in seconds (labelled "approx." in the UI). */
export function travelTimeSeconds(metres: number, mode: TravelMode): number {
  return metres / SPEEDS[mode];
}

const groupThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** "850 m", "3 412 m" (narrow no-break space as thousands separator). */
export function formatMetres(metres: number): string {
  return `${groupThousands(Math.round(metres))} m`;
}

/** "45 s", "2 min 05 s", "1 h 03 min". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}
