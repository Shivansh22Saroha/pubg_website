import { describe, expect, it } from 'vitest';
import { elementAnchor } from '../src/index.js';

describe('elementAnchor (Phase 12)', () => {
  it('a marker / text position, a circle centre, else the centre of its points', () => {
    expect(elementAnchor({ at: [10.4, 20.6] })).toEqual([10, 21]);
    expect(elementAnchor({ center: [500, 600], r: 9_000 })).toEqual([500, 600]);
    expect(
      elementAnchor({
        points: [
          [0, 0],
          [100, 300],
          [200, 100],
        ],
      }),
    ).toEqual([100, 150]);
    expect(elementAnchor({})).toBeNull();
  });
});
