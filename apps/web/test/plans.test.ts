import type { Layer } from '@rotationlab/shared';
import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  byCreation,
  compassPoint,
  createdAtOf,
  describeElement,
  formatOffset,
  planName,
  replayPace,
  routesOf,
} from '@/lib/plans';
import type { ViewElement } from '@/stores/boardModel';

/** Plan tools (FEATURES F24): routes, replay order, bearings — pure helpers. */

const LAYER = 'aaaaaaaa-0000-4000-8000-000000000001';
const layers: Layer[] = [
  {
    id: LAYER,
    boardId: 'bbbbbbbb-0000-4000-8000-000000000001',
    name: 'Rotation',
    color: '#F2A900',
    position: 0,
    visible: true,
    locked: false,
    seq: 1,
  },
];

/** a UUIDv7 made at `ms` */
function v7(ms: number, tail = 1): string {
  const h = ms.toString(16).padStart(12, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7000-8000-${tail.toString(16).padStart(12, '0')}`;
}

function el(
  id: string,
  type: ViewElement['type'],
  geometry: Record<string, unknown>,
  extra: Partial<ViewElement> = {},
): ViewElement {
  return {
    id,
    boardId: layers[0]!.boardId,
    layerId: LAYER,
    type,
    geometry,
    style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 },
    props: {},
    z: 0,
    seq: 1,
    createdBy: null,
    updatedBy: null,
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...extra,
  };
}

describe('createdAtOf / byCreation', () => {
  it('reads the creation time out of a UUIDv7, and nothing else', () => {
    const t = Date.UTC(2026, 10, 20, 17, 0, 0);
    expect(createdAtOf(v7(t))).toBe(t);
    expect(createdAtOf('0192f7a1-0000-4000-8000-000000000001')).toBeNull(); // v4
    expect(createdAtOf('not-a-uuid')).toBeNull();
  });

  it('orders by creation time, then seq for ids without one', () => {
    const a = el(v7(2000), 'LINE', {}, { seq: 9 });
    const b = el(v7(1000), 'LINE', {}, { seq: 10 });
    const c = el('0192f7a1-0000-4000-8000-000000000003', 'LINE', {}, { seq: 1 });
    const d = el('0192f7a1-0000-4000-8000-000000000004', 'LINE', {}, { seq: 2 });
    expect([a, d, c, b].sort(byCreation).map((e) => e.id)).toEqual([b.id, a.id, c.id, d.id]);
  });
});

describe('bearings', () => {
  it('follows the in-game compass: north up, clockwise', () => {
    const o: [number, number] = [1000, 1000];
    expect(bearingDeg(o, [1000, 0])).toBe(0);
    expect(bearingDeg(o, [2000, 1000])).toBe(90);
    expect(bearingDeg(o, [1000, 2000])).toBe(180);
    expect(bearingDeg(o, [0, 1000])).toBe(270);
    expect(bearingDeg(o, [2000, 0])).toBe(45);
    expect(bearingDeg(o, [0, 2000])).toBe(225);
  });
  it('names the nearest compass point', () => {
    expect([0, 22, 23, 90, 200, 245, 337, 359].map(compassPoint)).toEqual([
      'N',
      'N',
      'NE',
      'E',
      'S',
      'SW',
      'NW',
      'N',
    ]);
  });
});

describe('routesOf', () => {
  it('lists lines, arrows and pen paths on visible layers as Plan A, B, C — oldest first', () => {
    const elements = {
      line: el(v7(3000, 1), 'LINE', {
        points: [
          [0, 0],
          [0, 100_000],
        ],
      }),
      arrow: el(v7(1000, 2), 'ARROW', {
        points: [
          [0, 0],
          [100_000, 0],
        ],
      }),
      pen: el(v7(2000, 3), 'STROKE', {
        points: [
          [0, 0],
          [30_000, 40_000],
        ],
      }),
      circle: el(v7(500, 4), 'CIRCLE', { center: [0, 0], r: 5 }),
      marker: el(v7(600, 5), 'MARKER', { at: [0, 0] }, { props: { kind: 'pin' } }),
    };
    const byId = Object.fromEntries(Object.values(elements).map((e) => [e.id, e]));
    const routes = routesOf(byId, layers, 0.01);
    expect(routes.map((r) => [r.name, r.type])).toEqual([
      ['Plan A', 'ARROW'],
      ['Plan B', 'STROKE'],
      ['Plan C', 'LINE'],
    ]);
    expect(routes[0]!.summary.total).toBe(1000); // 100 000 cm
    expect(routes[0]!.bearing).toBe(90);
    expect(routes[1]!.summary.total).toBe(500); // 3-4-5
    expect(routes[2]!.bearing).toBe(180);
    expect(routes[2]!.layerName).toBe('Rotation');
    // a custom map's scale
    expect(routesOf(byId, layers, 0.02)[0]!.summary.total).toBe(2000);
  });

  it('skips hidden layers (also hidden in this tab only) and one-point paths', () => {
    const line = el(v7(1000), 'LINE', {
      points: [
        [0, 0],
        [0, 100],
      ],
    });
    const dot = el(v7(2000, 2), 'STROKE', { points: [[5, 5]] });
    const byId = { [line.id]: line, [dot.id]: dot };
    expect(routesOf(byId, layers, 0.01)).toHaveLength(1);
    expect(routesOf(byId, [{ ...layers[0]!, visible: false }], 0.01)).toHaveLength(0);
    expect(routesOf(byId, layers, 0.01, { [LAYER]: true })).toHaveLength(0);
  });
});

describe('replay helpers', () => {
  it('names plans and formats offsets', () => {
    expect([0, 1, 25, 26].map(planName)).toEqual(['Plan A', 'Plan B', 'Plan Z', 'Plan 27']);
    expect(formatOffset(0)).toBe('0:00');
    expect(formatOffset(42_000)).toBe('0:42');
    expect(formatOffset(725_000)).toBe('12:05');
    expect(formatOffset(3_725_000)).toBe('1:02:05');
    expect(formatOffset(3 * 86_400_000)).toBe('+3 d');
  });
  it('describes what was drawn', () => {
    expect(describeElement({ type: 'ARROW', props: {} })).toBe('drew an arrow');
    expect(describeElement({ type: 'MARKER', props: {} }, 'Enemy squad')).toBe(
      'marked enemy squad',
    );
  });
  it('plays any board in about 20 s', () => {
    expect(replayPace(5)).toEqual({ intervalMs: 700, perTick: 1 });
    expect(replayPace(100)).toEqual({ intervalMs: 200, perTick: 1 });
    const big = replayPace(5000);
    expect(big.intervalMs).toBe(40);
    expect((5000 / big.perTick) * big.intervalMs).toBeLessThanOrEqual(21_000);
  });
});
