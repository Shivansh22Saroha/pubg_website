import { describe, expect, it } from 'vitest';
import { measureLines } from '@/lib/measureToLine';

const opts = (() => {
  let n = 0;
  return {
    boardId: '0192f7a1-0000-7000-8000-000000000002',
    layerId: '0192f7a1-0000-7000-8000-000000000003',
    style: { color: '#22C55E', width: 2 as const, dashed: true, fillOpacity: 0 },
    newId: () => `0192f7a1-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  };
})();

describe('Save measure as line (Phase 11)', () => {
  it('two points → one LINE with the given style and layer', () => {
    const [line, ...rest] = measureLines(
      [
        [1000.4, 2000.6],
        [5000, 6000],
      ],
      opts,
    );
    expect(rest).toEqual([]);
    expect(line).toMatchObject({
      type: 'LINE',
      layerId: opts.layerId,
      geometry: {
        points: [
          [1000, 2001],
          [5000, 6000],
        ],
      },
      style: { color: '#22C55E', dashed: true },
      props: {},
    });
  });

  it('N points → N − 1 segments; zero-length segments are skipped', () => {
    const lines = measureLines(
      [
        [0, 0],
        [100, 0],
        [100, 0],
        [100, 100],
      ],
      opts,
    );
    expect(lines.map((l) => l.geometry)).toEqual([
      {
        points: [
          [0, 0],
          [100, 0],
        ],
      },
      {
        points: [
          [100, 0],
          [100, 100],
        ],
      },
    ]);
    expect(new Set(lines.map((l) => l.id)).size).toBe(2);
  });

  it('fewer than two points → nothing', () => {
    expect(measureLines([[0, 0]], opts)).toEqual([]);
  });
});
