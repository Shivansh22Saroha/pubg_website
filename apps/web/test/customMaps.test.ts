import { describe, expect, it, vi } from 'vitest';
import { boardMapInfo, boardMapName, customMapInfo, pubgMapInfo } from '@/lib/boardMap';

vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_TILES_BASE_URL: 'https://tiles.example/v1/' } }));

const map = {
  id: '0192f7a1-0000-7000-8000-0000000000c1',
  name: 'Bermuda',
  widthM: 2040,
  imageUrl: 'https://r2.example/a.webp?sig',
  previewUrl: 'https://r2.example/a-512.webp?sig',
};

describe('board map resolution (F20)', () => {
  it('PUBG maps come from the registry, in centimetres', () => {
    const info = pubgMapInfo('miramar');
    expect(info).toMatchObject({ kind: 'pubg', name: 'Miramar', worldSize: 816_000 });
    expect(info.metresPerUnit).toBe(0.01);
    expect(info.backgroundUrl).toBe('https://tiles.example/v1/miramar/lowres.jpg');
  });

  it('custom maps: same square, their own scale, the preview as background', () => {
    const info = customMapInfo(map);
    expect(info).toMatchObject({ kind: 'custom', name: 'Bermuda', worldSize: 816_000 });
    expect(info.worldSize * info.metresPerUnit).toBeCloseTo(2040);
    expect(info.backgroundUrl).toBe(map.previewUrl);
    expect(info.config.maxNativeZoom).toBe(4);
  });

  it('resolves a board from the room list; null until its map is there', () => {
    const board = { mapId: 'custom' as const, customMapId: map.id };
    expect(boardMapInfo(board, [map])?.name).toBe('Bermuda');
    expect(boardMapInfo(board, undefined)).toBeNull();
    expect(boardMapInfo(board, [{ ...map, id: 'other' }])).toBeNull();
    expect(boardMapInfo({ mapId: 'rondo', customMapId: null }, undefined)?.name).toBe('Rondo');
    // a share link carries exactly its own map, without an id
    const { id: _id, ...publicMap } = map;
    expect(boardMapInfo(board, [publicMap])?.name).toBe('Bermuda');
  });

  it('names boards for tab titles', () => {
    expect(boardMapName({ mapId: 'erangel' })).toBe('Erangel');
    expect(boardMapName({ mapId: 'custom', customMapId: map.id }, [map])).toBe('Bermuda');
    expect(boardMapName({ mapId: 'custom', customMapId: map.id })).toBe('Custom map');
  });
});
