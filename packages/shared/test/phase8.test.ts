import { describe, expect, it } from 'vitest';
import {
  buildSnapshotData,
  formatMeasure,
  measure,
  parseSnapshotData,
  SNAPSHOT_LIMITS,
  snapshotBytes,
  SnapshotDataSchema,
  type Pt,
} from '../src/index.js';

const L1 = '0192f7a1-0000-7000-8000-0000000000c1';
const L2 = '0192f7a1-0000-7000-8000-0000000000c2';
const E1 = '0192f7a1-0000-7000-8000-0000000000e1';
const USER = '0192f7a1-0000-7000-8000-0000000000aa';

const layer = (id: string, position: number) => ({
  id,
  boardId: 'b',
  name: `Layer ${position}`,
  color: '#F2A900',
  position,
  visible: true,
  locked: false,
  seq: 9,
});
const element = (id: string, layerId: string) => ({
  id,
  boardId: 'b',
  layerId,
  type: 'LINE' as const,
  geometry: {
    points: [
      [0, 0],
      [100, 100],
    ],
  },
  style: { color: '#F2A900', width: 4 as const, dashed: false, fillOpacity: 0 },
  props: {},
  z: 3,
  seq: 12,
  createdBy: USER,
  updatedBy: USER,
  updatedAt: '2026-10-26T10:00:00.000Z',
});

describe('snapshot (de)serialization (FEATURES F10)', () => {
  it('keeps ids and what a restore needs, drops seqs / timestamps, re-sequences positions', () => {
    const data = buildSnapshotData([layer(L2, 4), layer(L1, 1)], [element(E1, L1)]);
    expect(data).toEqual({
      version: 1,
      layers: [
        { id: L1, name: 'Layer 1', color: '#F2A900', position: 0, visible: true, locked: false },
        { id: L2, name: 'Layer 4', color: '#F2A900', position: 1, visible: true, locked: false },
      ],
      elements: [
        {
          id: E1,
          layerId: L1,
          type: 'LINE',
          geometry: {
            points: [
              [0, 0],
              [100, 100],
            ],
          },
          style: { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 },
          props: {},
          z: 3,
          createdBy: USER,
        },
      ],
    });
    expect(parseSnapshotData(JSON.parse(JSON.stringify(data)))).toEqual(data); // round trip
  });

  it('rejects other versions, elements on unknown layers, no layers, and bad colours', () => {
    const good = buildSnapshotData([layer(L1, 0)], [element(E1, L1)]);
    expect(() => parseSnapshotData({ ...good, version: 2 })).toThrow();
    expect(() =>
      parseSnapshotData({ ...good, elements: [{ ...good.elements[0], layerId: L2 }] }),
    ).toThrow(/snapshot’s layers/);
    expect(() => parseSnapshotData({ ...good, layers: [] })).toThrow();
    expect(() =>
      parseSnapshotData({ ...good, layers: [{ ...good.layers[0], color: 'red' }] }),
    ).toThrow();
  });

  it('limits: ≤ 5 000 elements, ≤ 10 layers; the 5 MB cap is measured in UTF-8 bytes', () => {
    const many = Array.from({ length: 5001 }, (_, i) =>
      element(`0192f7a1-0000-7000-8000-${String(i).padStart(12, '0')}`, L1),
    );
    expect(SnapshotDataSchema.safeParse(buildSnapshotData([layer(L1, 0)], many)).success).toBe(
      false,
    );
    const eleven = Array.from({ length: 11 }, (_, i) =>
      layer(`0192f7a1-0000-7000-8000-${String(100 + i).padStart(12, '0')}`, i),
    );
    expect(SnapshotDataSchema.safeParse(buildSnapshotData(eleven, [])).success).toBe(false);
    expect(snapshotBytes({ s: 'é' })).toBe(JSON.stringify({ s: 'é' }).length + 1);
    expect(SNAPSHOT_LIMITS).toMatchObject({
      maxBytes: 5 * 1024 * 1024,
      manualPerBoard: 50,
      autoPerBoard: 10,
      nameMax: 60,
    });
  });
});

describe('measure maths & formatting (FEATURES F11)', () => {
  it('segments and total in metres (world / 100)', () => {
    const pts: Pt[] = [
      [0, 0],
      [30_000, 40_000], // 500 m
      [30_000, 340_000], // 3 000 m
    ];
    const m = measure(pts);
    expect(m.segments).toEqual([500, 3000]);
    expect(m.total).toBe(3500);
  });

  it('travel time from SPEEDS, whole minutes, at least 1 once there is distance', () => {
    expect(
      measure([
        [0, 0],
        [0, 342_000],
      ]),
    ).toMatchObject({ total: 3420, footMin: 10, vehicleMin: 3 });
    expect(
      measure([
        [0, 0],
        [0, 100],
      ]),
    ).toMatchObject({ footMin: 1, vehicleMin: 1 });
    expect(measure([[0, 0]])).toMatchObject({ total: 0, footMin: 0, vehicleMin: 0, segments: [] });
  });

  it('formats with a thin-space thousands separator and "(approx.)"', () => {
    expect(
      formatMeasure(
        measure([
          [0, 0],
          [0, 342_000],
        ]),
      ),
    ).toBe('3 420 m · ~10 min on foot · ~3 min by vehicle (approx.)');
  });
});
