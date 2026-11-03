import { describe, expect, it } from 'vitest';
import { keyPan, minimapToWorld, viewportRect } from '@/lib/minimap';

const W = 816_000;

describe('minimap geometry (Phase 11)', () => {
  it('maps the whole map to the full square and a quarter view to a quarter', () => {
    expect(viewportRect({ minX: 0, minY: 0, maxX: W, maxY: W }, W)).toEqual({
      left: 0,
      top: 0,
      width: 160,
      height: 160,
    });
    expect(viewportRect({ minX: W / 2, minY: 0, maxX: W, maxY: W / 2 }, W)).toEqual({
      left: 80,
      top: 0,
      width: 80,
      height: 80,
    });
  });

  it('clamps a view that hangs over the edge (maxBounds padding), null when fully off', () => {
    expect(viewportRect({ minX: -W, minY: -W, maxX: W / 4, maxY: W / 4 }, W)).toEqual({
      left: 0,
      top: 0,
      width: 40,
      height: 40,
    });
    expect(viewportRect({ minX: W + 1, minY: 0, maxX: W * 2, maxY: W }, W)).toBeNull();
  });

  it('turns minimap pixels into clamped world units', () => {
    expect(minimapToWorld(80, 40, W, W)).toEqual([408_000, 204_000]);
    expect(minimapToWorld(-5, 500, W, W)).toEqual([0, W]);
    expect(minimapToWorld(160, 160, W, W, 320)).toEqual([408_000, 408_000]); // a larger box
  });

  it('arrow keys pan a tenth of the map; other keys do nothing', () => {
    expect(keyPan('ArrowLeft', W)).toEqual([-81_600, 0]);
    expect(keyPan('ArrowDown', W)).toEqual([0, 81_600]);
    expect(keyPan('Enter', W)).toBeNull();
  });
});
