/**
 * Pure geometry on world units (cm). Used by the drawing tools (Phase 6A) and by select /
 * eraser hit-testing (Phase 6B). Nothing here knows about Leaflet or screen pixels — callers
 * convert pixel tolerances with "world units per pixel" at the current zoom.
 */
import type { Pt } from './coords.js';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Geometry as stored on any element (DATABASE_SCHEMA §4), loosely typed. */
export interface AnyGeometry {
  points?: readonly Pt[];
  center?: Pt;
  r?: number;
  at?: Pt;
}

export interface HitTarget {
  type: 'STROKE' | 'LINE' | 'ARROW' | 'CIRCLE' | 'POLYGON' | 'TEXT' | 'MARKER';
  geometry: AnyGeometry;
  style?: { fillOpacity?: number };
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function bboxOfPoints(points: readonly Pt[]): BBox | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Bounding box of an element's geometry (a circle includes its radius; a point is a zero box). */
export function elementBBox(g: AnyGeometry): BBox | null {
  if (g.points) return bboxOfPoints(g.points);
  if (g.center) {
    const r = g.r ?? 0;
    const [x, y] = g.center;
    return { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
  }
  if (g.at) return bboxOfPoints([g.at]);
  return null;
}

export function expandBBox(b: BBox, d: number): BBox {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function bboxContainsPoint(b: BBox, [x, y]: Pt): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** Shortest distance from `p` to the segment a–b (a degenerate segment is a point). */
export function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Shortest distance from `p` to a polyline; `closed` adds the last → first edge. */
export function pointToPolylineDistance(p: Pt, points: readonly Pt[], closed = false): number {
  const first = points[0];
  if (!first) return Infinity;
  if (points.length === 1) return distance(p, first);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) best = Math.min(best, pointToSegmentDistance(p, a, b));
  }
  const last = points.at(-1);
  if (closed && last) best = Math.min(best, pointToSegmentDistance(p, last, first));
  return best;
}

/** Even-odd ray casting; points exactly on an edge may land either way. */
export function pointInPolygon([x, y]: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Does `p` hit the element, with a world-space tolerance (the caller converts screen px)?
 * Lines hit near their path; circles and polygons near their outline, or anywhere inside when
 * they are filled; text and markers within `tol` of their anchor.
 */
export function hitTest(el: HitTarget, p: Pt, tol: number): boolean {
  const g = el.geometry;
  const filled = (el.style?.fillOpacity ?? 0) > 0;
  switch (el.type) {
    case 'STROKE':
    case 'LINE':
    case 'ARROW':
      return pointToPolylineDistance(p, g.points ?? []) <= tol;
    case 'POLYGON': {
      const pts = g.points ?? [];
      return pointToPolylineDistance(p, pts, true) <= tol || (filled && pointInPolygon(p, pts));
    }
    case 'CIRCLE': {
      if (!g.center) return false;
      const d = distance(p, g.center);
      const r = g.r ?? 0;
      return Math.abs(d - r) <= tol || (filled && d <= r);
    }
    case 'TEXT':
    case 'MARKER':
      return g.at ? distance(p, g.at) <= tol : false;
  }
}

/** Radius (integer world units) of a circle centred at `center` passing through `edge`. */
export function circleRadius(center: Pt, edge: Pt): number {
  return Math.round(distance(center, edge));
}

/** Circle with `a` and `b` on opposite edges ("draw from the edge"). */
export function circleFromEdge(a: Pt, b: Pt): { center: Pt; r: number } {
  return {
    center: [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)],
    r: Math.round(distance(a, b) / 2),
  };
}

/**
 * Snap `p` so the direction origin → p is a multiple of `stepDeg` (default 15°), keeping the
 * distance. Integer world units out.
 */
export function snapAngle(origin: Pt, p: Pt, stepDeg = 15): Pt {
  const len = distance(origin, p);
  if (len === 0) return [origin[0], origin[1]];
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(p[1] - origin[1], p[0] - origin[0]) / step) * step;
  return [
    Math.round(origin[0] + Math.cos(angle) * len),
    Math.round(origin[1] + Math.sin(angle) * len),
  ];
}

/** Round to integer world units and clamp into the map (0…worldSize). */
export function clampToWorld([x, y]: Pt, worldSize: number): Pt {
  const c = (v: number) => Math.min(worldSize, Math.max(0, Math.round(v)));
  return [c(x), c(y)];
}

// ---- selection / move (Phase 6B) --------------------------------------------------------------

/** Union of boxes; null when there are none. */
export function unionBBox(boxes: Iterable<BBox | null>): BBox | null {
  let out: BBox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out
      ? {
          minX: Math.min(out.minX, b.minX),
          minY: Math.min(out.minY, b.minY),
          maxX: Math.max(out.maxX, b.maxX),
          maxY: Math.max(out.maxY, b.maxY),
        }
      : { ...b };
  }
  return out;
}

/** Box spanned by two corners in any order (marquee). */
export function bboxFromCorners(a: Pt, b: Pt): BBox {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

/**
 * Box of the *stored* coordinates — what must stay inside the map (`elementWithinWorld`).
 * Unlike `elementBBox`, a circle contributes only its centre.
 */
export function anchorBBox(g: AnyGeometry): BBox | null {
  if (g.points) return bboxOfPoints(g.points);
  if (g.center) return bboxOfPoints([g.center]);
  if (g.at) return bboxOfPoints([g.at]);
  return null;
}

/**
 * Shrinks a translation so `box` moved by (dx, dy) stays inside 0…worldSize — the whole
 * selection moves rigidly instead of being squashed against the edge. Integers out.
 */
export function clampTranslation(
  box: BBox,
  dx: number,
  dy: number,
  worldSize: number,
): [number, number] {
  const c = (d: number, min: number, max: number) =>
    Math.round(Math.min(worldSize - max, Math.max(-min, d)));
  return [c(dx, box.minX, box.maxX), c(dy, box.minY, box.maxY)];
}

/** Geometry moved by (dx, dy); the radius is kept. Integer world units in → out. */
export function translateGeometry<G extends AnyGeometry>(g: G, dx: number, dy: number): G {
  const t = ([x, y]: Pt): [number, number] => [x + dx, y + dy];
  const out: AnyGeometry = { ...g };
  if (g.points) out.points = g.points.map(t);
  if (g.center) out.center = t(g.center);
  if (g.at) out.at = t(g.at);
  return out as G;
}

/**
 * Points from `a` to `b` (both included) at most `step` apart — an eraser sweep between two
 * pointer samples is hit-tested at each of them, so a fast drag can't skip an element.
 */
export function sweepPoints(a: Pt, b: Pt, step: number): Pt[] {
  const d = distance(a, b);
  const n = step > 0 ? Math.min(1000, Math.ceil(d / step)) : 0;
  if (n <= 1) return d === 0 ? [a] : [a, b];
  return Array.from({ length: n + 1 }, (_, i): Pt => {
    const t = i / n;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
}
