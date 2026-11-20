import { describe, expect, it } from 'vitest';
import { RecallFileSchema, clusterRecalls } from '../src/index.js';

const W = 816_000;

describe('recall towers', () => {
  it('merges Blue Chip uses near each other into one tower, counted by matches', () => {
    const towers = clusterRecalls(
      [
        { x: 100_000, y: 200_000, matchId: 'a' },
        { x: 100_400, y: 200_200, matchId: 'b' },
        { x: 100_200, y: 199_900, matchId: 'b' }, // squadmate, same match
        { x: 500_000, y: 500_000, matchId: 'a' },
        { x: 500_300, y: 500_100, matchId: 'c' },
      ],
      W,
    );
    expect(towers).toEqual([
      { x: 100_200, y: 200_033, seen: 2 },
      { x: 500_150, y: 500_050, seen: 2 },
    ]);
  });

  it('drops a spot seen in one match only, and points off the map', () => {
    expect(
      clusterRecalls(
        [
          { x: 300_000, y: 300_000, matchId: 'a' },
          { x: -5, y: 10, matchId: 'a' },
          { x: -5, y: 10, matchId: 'b' },
        ],
        W,
      ),
    ).toEqual([]);
  });

  it('validates the data file', () => {
    const file = {
      mapId: 'rondo',
      source: 'pubg-api',
      shard: 'steam',
      generatedAt: '2026-11-20T04:20:40.751Z',
      matches: 400,
      towers: [{ x: 1, y: 2, seen: 3 }],
    };
    expect(RecallFileSchema.safeParse(file).success).toBe(true);
    expect(RecallFileSchema.safeParse({ ...file, mapId: 'vikendi' }).success).toBe(false);
    expect(
      RecallFileSchema.safeParse({ ...file, towers: [{ x: 1.5, y: 2, seen: 1 }] }).success,
    ).toBe(false);
  });
});
