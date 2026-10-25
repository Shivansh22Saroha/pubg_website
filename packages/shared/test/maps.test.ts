import { describe, expect, it } from 'vitest';
import {
  GRID_CELLS,
  GRID_COLUMN_LETTERS,
  GRID_ROW_LETTERS,
  MAP_IDS,
  MAPS,
  isMapId,
  tileWorldSize,
} from '../src/index.js';

describe('map registry', () => {
  it('has an entry for every map id, keyed by its own id', () => {
    for (const id of MAP_IDS) expect(MAPS[id].id).toBe(id);
  });

  it('uses 816 000 cm world size for all v1 maps', () => {
    for (const id of MAP_IDS) expect(MAPS[id].worldSize).toBe(816_000);
  });

  it('has a consistent tile pyramid: paddedSize = 256·2^maxNativeZoom ≥ sourceSize', () => {
    for (const id of MAP_IDS) {
      const m = MAPS[id];
      expect(m.paddedSize).toBe(m.tileSize * 2 ** m.maxNativeZoom);
      expect(m.paddedSize).toBeGreaterThanOrEqual(m.sourceSize);
      expect(m.paddedSize / 2).toBeLessThan(m.sourceSize);
    }
  });

  it('scales the tile world size by the padding ratio', () => {
    expect(tileWorldSize({ worldSize: 816_000, sourceSize: 8192, paddedSize: 8192 })).toBe(816_000);
    expect(tileWorldSize({ worldSize: 816_000, sourceSize: 6000, paddedSize: 8192 })).toBeCloseTo(
      1_114_112,
    );
  });

  it('builds tile paths relative to the tiles base', () => {
    expect(MAPS.rondo.variants).toEqual({ labels: 'rondo/labels', clean: 'rondo/clean' });
    expect(MAPS.miramar.lowres).toBe('miramar/lowres.jpg');
  });

  it('validates map ids', () => {
    expect(isMapId('erangel')).toBe(true);
    expect(isMapId('sanhok')).toBe(false);
  });

  it('has one letter per grid cell on each axis, with no overlap', () => {
    expect(GRID_COLUMN_LETTERS).toHaveLength(GRID_CELLS);
    expect(GRID_ROW_LETTERS).toHaveLength(GRID_CELLS);
    const all = new Set(GRID_COLUMN_LETTERS + GRID_ROW_LETTERS);
    expect(all.size).toBe(GRID_CELLS * 2);
  });
});
