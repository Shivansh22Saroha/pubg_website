import { describe, expect, it } from 'vitest';
import {
  anchorBBox,
  bboxContainsPoint,
  bboxFromCorners,
  clampTranslation,
  translateGeometry,
  sweepPoints,
  unionBBox,
  bboxIntersects,
  bboxOfPoints,
  circleFromEdge,
  circleRadius,
  clampToWorld,
  distance,
  DRAWING_PALETTE,
  elementBBox,
  expandBBox,
  hitTest,
  MARKER_DEFAULT_COLORS,
  MARKER_KINDS,
  MAPS,
  pointInPolygon,
  pointToPolylineDistance,
  pointToSegmentDistance,
  snapAngle,
  ZONE_PRESETS,
  type Pt,
} from '../src/index.js';

const square: Pt[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe('bounding boxes', () => {
  it('of points, circles (radius included) and anchors', () => {
    expect(bboxOfPoints([])).toBeNull();
    expect(
      bboxOfPoints([
        [5, 9],
        [-2, 3],
        [7, 1],
      ]),
    ).toEqual({ minX: -2, minY: 1, maxX: 7, maxY: 9 });
    expect(elementBBox({ center: [100, 200], r: 50 })).toEqual({
      minX: 50,
      minY: 150,
      maxX: 150,
      maxY: 250,
    });
    expect(elementBBox({ at: [3, 4] })).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
    expect(elementBBox({})).toBeNull();
  });

  it('expand, intersect and contain', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(expandBBox(a, 5)).toEqual({ minX: -5, minY: -5, maxX: 15, maxY: 15 });
    expect(bboxIntersects(a, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true); // touching
    expect(bboxIntersects(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(bboxContainsPoint(a, [5, 10])).toBe(true);
    expect(bboxContainsPoint(a, [5, 11])).toBe(false);
  });
});

describe('distances', () => {
  it('point to segment: perpendicular, beyond either end, degenerate segment', () => {
    expect(pointToSegmentDistance([5, 5], [0, 0], [10, 0])).toBe(5);
    expect(pointToSegmentDistance([-3, 4], [0, 0], [10, 0])).toBe(5); // past a
    expect(pointToSegmentDistance([13, 4], [0, 0], [10, 0])).toBe(5); // past b
    expect(pointToSegmentDistance([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it('point to polyline, optionally closed', () => {
    const open: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(pointToPolylineDistance([50, 10], open)).toBe(10);
    // near the missing closing edge (100,100) → (0,0)
    expect(pointToPolylineDistance([40, 50], open)).toBeCloseTo(50);
    expect(pointToPolylineDistance([40, 50], open, true)).toBeCloseTo(Math.SQRT2 * 5);
    expect(pointToPolylineDistance([1, 1], [])).toBe(Infinity);
    expect(pointToPolylineDistance([3, 4], [[0, 0]])).toBe(5);
  });

  it('distance is Euclidean', () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
  });
});

describe('point in polygon', () => {
  it('inside / outside a square and a concave shape', () => {
    expect(pointInPolygon([50, 50], square)).toBe(true);
    expect(pointInPolygon([150, 50], square)).toBe(false);
    const u: Pt[] = [
      [0, 0],
      [30, 0],
      [30, 100],
      [70, 100],
      [70, 0],
      [100, 0],
      [100, 120],
      [0, 120],
    ];
    expect(pointInPolygon([50, 50], u)).toBe(false); // in the notch
    expect(pointInPolygon([50, 110], u)).toBe(true);
    expect(pointInPolygon([10, 10], u)).toBe(true);
  });
});

describe('hitTest', () => {
  it('lines, strokes and arrows: near the path only', () => {
    for (const type of ['STROKE', 'LINE', 'ARROW'] as const) {
      const el = {
        type,
        geometry: {
          points: [
            [0, 0],
            [1000, 0],
          ] as Pt[],
        },
      };
      expect(hitTest(el, [500, 40], 50)).toBe(true);
      expect(hitTest(el, [500, 60], 50)).toBe(false);
    }
  });

  it('polygons: outline always, interior only when filled', () => {
    const el = { type: 'POLYGON' as const, geometry: { points: square } };
    expect(hitTest(el, [50, 2], 5)).toBe(true);
    expect(hitTest(el, [2, 50], 5)).toBe(true); // closing edge
    expect(hitTest(el, [50, 50], 5)).toBe(false);
    expect(hitTest({ ...el, style: { fillOpacity: 0.15 } }, [50, 50], 5)).toBe(true);
  });

  it('circles: ring always, disc only when filled', () => {
    const el = { type: 'CIRCLE' as const, geometry: { center: [0, 0] as Pt, r: 100 } };
    expect(hitTest(el, [104, 0], 5)).toBe(true);
    expect(hitTest(el, [10, 0], 5)).toBe(false);
    expect(hitTest({ ...el, style: { fillOpacity: 0.1 } }, [10, 0], 5)).toBe(true);
    expect(hitTest({ ...el, style: { fillOpacity: 0.1 } }, [120, 0], 5)).toBe(false);
    expect(hitTest({ type: 'CIRCLE', geometry: {} }, [0, 0], 5)).toBe(false);
  });

  it('text and markers: within tolerance of the anchor', () => {
    for (const type of ['TEXT', 'MARKER'] as const) {
      const el = { type, geometry: { at: [100, 100] as Pt } };
      expect(hitTest(el, [110, 110], 15)).toBe(true);
      expect(hitTest(el, [120, 120], 15)).toBe(false);
    }
  });
});

describe('circle helpers', () => {
  it('radius from centre and edge (integer)', () => {
    expect(circleRadius([0, 0], [300, 400])).toBe(500);
    expect(circleRadius([0, 0], [1, 1])).toBe(1);
  });

  it('from the edge: midpoint centre, half the span', () => {
    expect(circleFromEdge([0, 0], [600, 800])).toEqual({ center: [300, 400], r: 500 });
  });
});

describe('snapAngle (15°)', () => {
  it('snaps to the nearest multiple and keeps length', () => {
    expect(snapAngle([0, 0], [100, 3])).toEqual([100, 0]);
    expect(snapAngle([0, 0], [70, 72])).toEqual([71, 71]); // 45°
    const p = snapAngle([0, 0], [100, 30]); // ~16.7° → 15°
    expect(Math.atan2(p[1], p[0]) * (180 / Math.PI)).toBeCloseTo(15, 0);
    expect(distance([0, 0], p)).toBeCloseTo(Math.hypot(100, 30), -1);
    expect(snapAngle([5, 5], [5, 5])).toEqual([5, 5]);
    expect(snapAngle([0, 0], [-100, 2])).toEqual([-100, 0]);
  });

  it('accepts another step', () => {
    expect(snapAngle([0, 0], [100, 40], 90)).toEqual([108, 0]);
  });
});

describe('clampToWorld', () => {
  it('rounds and clamps into 0…worldSize', () => {
    expect(clampToWorld([-5, 10.6], 1000)).toEqual([0, 11]);
    expect(clampToWorld([2000, 999.4], 1000)).toEqual([1000, 999]);
  });
});

describe('drawing constants', () => {
  it('has the 10-colour palette and a default colour per marker kind', () => {
    expect(DRAWING_PALETTE).toHaveLength(10);
    expect(Object.keys(MARKER_DEFAULT_COLORS).sort()).toEqual([...MARKER_KINDS].sort());
  });

  it('zone presets exist for every map and ship empty (TODO phase0)', () => {
    expect(Object.keys(ZONE_PRESETS).sort()).toEqual(Object.keys(MAPS).sort());
    for (const list of Object.values(ZONE_PRESETS)) expect(list).toEqual([]);
  });
});

describe('selection helpers (6B)', () => {
  it('union and corner boxes', () => {
    expect(unionBBox([])).toBeNull();
    expect(
      unionBBox([
        { minX: 0, minY: 5, maxX: 10, maxY: 10 },
        null,
        { minX: -5, minY: 6, maxX: 3, maxY: 20 },
      ]),
    ).toEqual({ minX: -5, minY: 5, maxX: 10, maxY: 20 });
    expect(bboxFromCorners([10, 0], [0, 10])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('anchor box ignores the circle radius', () => {
    expect(anchorBBox({ center: [100, 200], r: 50 })).toEqual({
      minX: 100,
      minY: 200,
      maxX: 100,
      maxY: 200,
    });
    expect(anchorBBox({ points: square })).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(anchorBBox({})).toBeNull();
  });

  it('clampTranslation keeps the whole box inside and moves it rigidly', () => {
    const box = { minX: 100, minY: 100, maxX: 300, maxY: 200 };
    expect(clampTranslation(box, 50, -20, 1000)).toEqual([50, -20]);
    expect(clampTranslation(box, -500, 0, 1000)).toEqual([-100, 0]);
    expect(clampTranslation(box, 900, 900, 1000)).toEqual([700, 800]);
    expect(clampTranslation(box, 10.4, 0, 1000)).toEqual([10, 0]);
  });

  it('translateGeometry moves points, centres and anchors but keeps the radius', () => {
    expect(
      translateGeometry(
        {
          points: [
            [0, 0],
            [10, 5],
          ] as Pt[],
        },
        3,
        4,
      ),
    ).toEqual({
      points: [
        [3, 4],
        [13, 9],
      ],
    });
    expect(translateGeometry({ center: [5, 5] as Pt, r: 9 }, -5, 1)).toEqual({
      center: [0, 6],
      r: 9,
    });
    expect(translateGeometry({ at: [1, 1] as Pt }, 1, 1)).toEqual({ at: [2, 2] });
  });

  it('sweepPoints spaces samples at most `step` apart, ends included', () => {
    const pts = sweepPoints([0, 0], [100, 0], 30);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([100, 0]);
    expect(pts).toHaveLength(5); // ceil(100/30) = 4 gaps
    for (let i = 1; i < pts.length; i++)
      expect(distance(pts[i - 1]!, pts[i]!)).toBeLessThanOrEqual(30);
    expect(sweepPoints([5, 5], [5, 5], 10)).toEqual([[5, 5]]);
    expect(sweepPoints([0, 0], [5, 0], 10)).toEqual([
      [0, 0],
      [5, 0],
    ]);
  });
});
