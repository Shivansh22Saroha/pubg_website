import { describe, expect, it } from 'vitest';
import { distanceMetres } from '../src/coords.js';
import {
  CUSTOM_MAP_LIMITS,
  DEFAULT_WORLD_SIZE,
  isPubgMap,
  metresPerUnit,
  PUBG_METRES_PER_UNIT,
  worldSizeOf,
} from '../src/maps.js';
import { measure } from '../src/measure.js';
import {
  UpdateCustomMapBodySchema,
  UploadCustomMapQuerySchema,
} from '../src/schemas/customMaps.js';
import { CreateBoardBodySchema } from '../src/schemas/rooms.js';

const id = '0192f7a1-0000-7000-8000-000000000001';

describe('custom maps (F20)', () => {
  it('share the PUBG coordinate square; only the metres differ', () => {
    expect(worldSizeOf('custom')).toBe(DEFAULT_WORLD_SIZE);
    expect(worldSizeOf('erangel')).toBe(DEFAULT_WORLD_SIZE);
    expect(isPubgMap('custom')).toBe(false);
    expect(isPubgMap('miramar')).toBe(true);
    // a 2 040 m map: crossing the whole square is 2 040 m
    const mpu = metresPerUnit(2_040);
    expect(distanceMetres([0, 0], [DEFAULT_WORLD_SIZE, 0], mpu)).toBeCloseTo(2_040);
    // PUBG default stays centimetres
    expect(distanceMetres([0, 0], [100_000, 0])).toBe(1_000);
    expect(PUBG_METRES_PER_UNIT).toBe(0.01);
    const m = measure(
      [
        [0, 0],
        [DEFAULT_WORLD_SIZE / 2, 0],
      ],
      mpu,
    );
    expect(m.total).toBeCloseTo(1_020);
  });

  it('parses upload query strings strictly', () => {
    expect(UploadCustomMapQuerySchema.parse({ name: ' Bermuda ', widthM: '2000' })).toEqual({
      name: 'Bermuda',
      widthM: 2000,
    });
    for (const q of [
      { name: 'x', widthM: '2000.5' },
      { name: 'x', widthM: '1e4' },
      { name: 'x', widthM: ' 2000' },
      { name: 'x', widthM: String(CUSTOM_MAP_LIMITS.widthMinM - 1) },
      { name: 'x', widthM: String(CUSTOM_MAP_LIMITS.widthMaxM + 1) },
      { name: '', widthM: '2000' },
      { name: 'x'.repeat(41), widthM: '2000' },
      { name: 'x', widthM: '2000', extra: '1' },
    ])
      expect(UploadCustomMapQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
  });

  it('updates need something to change', () => {
    expect(UpdateCustomMapBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateCustomMapBodySchema.safeParse({ widthM: 3000 }).success).toBe(true);
  });

  it('a board on a custom map names it; other boards must not', () => {
    const ok = (b: object) => CreateBoardBodySchema.safeParse({ name: 'Plan', ...b }).success;
    expect(ok({ mapId: 'custom', customMapId: id })).toBe(true);
    expect(ok({ mapId: 'erangel' })).toBe(true);
    expect(ok({ mapId: 'custom' })).toBe(false);
    expect(ok({ mapId: 'erangel', customMapId: id })).toBe(false);
  });
});
