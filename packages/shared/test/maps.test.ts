import { describe, expect, it } from 'vitest';
import {
  GRID_CELLS,
  GRID_COLUMN_LETTERS,
  GRID_ROW_LETTERS,
  MAP_IDS,
  WORLD_SIZE,
} from '../src/index.js';

describe('map constants', () => {
  it('defines a world size for every map, in centimetres', () => {
    for (const id of MAP_IDS) expect(WORLD_SIZE[id]).toBe(816_000);
  });

  it('has one letter per grid cell on each axis, with no overlap', () => {
    expect(GRID_COLUMN_LETTERS).toHaveLength(GRID_CELLS);
    expect(GRID_ROW_LETTERS).toHaveLength(GRID_CELLS);
    const all = new Set(GRID_COLUMN_LETTERS + GRID_ROW_LETTERS);
    expect(all.size).toBe(GRID_CELLS * 2);
  });
});
