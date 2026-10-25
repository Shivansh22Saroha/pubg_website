import { describe, expect, it } from 'vitest';
import {
  distanceMetres,
  formatDuration,
  formatMetres,
  gridLines,
  gridRef,
  isInWorld,
  pathLengthMetres,
  travelTimeSeconds,
} from '../src/index.js';

const W = 816_000;
const CELL = W / 8; // 102 000

describe('gridRef', () => {
  it('maps the corners (TESTING §3)', () => {
    expect(gridRef([0, 0], W)?.square).toBe('A-I');
    expect(gridRef([815_999, 815_999], W)?.square).toBe('H-P');
    expect(gridRef([815_999, 0], W)?.square).toBe('H-I');
    expect(gridRef([0, 815_999], W)?.square).toBe('A-P');
  });

  it('puts the far edge (exactly worldSize) in the last square', () => {
    expect(gridRef([W, W], W)?.label).toBe('H-P 9,9');
  });

  it('switches square exactly at 102 000', () => {
    expect(gridRef([CELL - 1, 0], W)?.col).toBe('A');
    expect(gridRef([CELL, 0], W)?.col).toBe('B');
    expect(gridRef([0, CELL - 1], W)?.row).toBe('I');
    expect(gridRef([0, CELL], W)?.row).toBe('J');
  });

  it('computes 100 m sub-square digits', () => {
    // F = col 5, M = row 4 → origin (510 000, 408 000); sub (4,7) → +40 800, +71 400
    const ref = gridRef([5 * CELL + 4 * (CELL / 10) + 1, 4 * CELL + 7 * (CELL / 10) + 1], W);
    expect(ref?.label).toBe('F-M 4,7');
    expect(ref?.sub).toEqual([4, 7]);
    expect(gridRef([CELL / 10 - 1, CELL / 10], W)?.sub).toEqual([0, 1]);
  });

  it('returns null outside the map', () => {
    expect(gridRef([-1, 0], W)).toBeNull();
    expect(gridRef([0, W + 1], W)).toBeNull();
    expect(isInWorld([W, 0], W)).toBe(true);
  });
});

describe('gridLines', () => {
  it('returns divisions + 1 evenly spaced lines including both edges', () => {
    const major = gridLines(W, 8);
    expect(major).toHaveLength(9);
    expect(major[0]).toBe(0);
    expect(major[1]).toBe(CELL);
    expect(major.at(-1)).toBe(W);
    expect(gridLines(W, 80)).toHaveLength(81);
  });
});

describe('distance & travel time', () => {
  it('converts centimetres to metres', () => {
    expect(distanceMetres([0, 0], [30_000, 40_000])).toBe(500);
    expect(distanceMetres([0, 0], [W, 0])).toBe(8160);
  });

  it('sums polyline length', () => {
    expect(
      pathLengthMetres([
        [0, 0],
        [10_000, 0],
        [10_000, 10_000],
      ]),
    ).toBe(200);
    expect(pathLengthMetres([[5, 5]])).toBe(0);
  });

  it('estimates travel time from SPEEDS', () => {
    expect(travelTimeSeconds(600, 'foot')).toBe(100);
    expect(travelTimeSeconds(2200, 'vehicle')).toBe(100);
  });

  it('formats metres and durations', () => {
    expect(formatMetres(850.4)).toBe('850 m');
    expect(formatMetres(3412)).toBe('3 412 m');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(125)).toBe('2 min 05 s');
    expect(formatDuration(3780)).toBe('1 h 03 min');
    expect(formatDuration(-3)).toBe('0 s');
  });
});
