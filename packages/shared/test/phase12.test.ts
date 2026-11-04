import { describe, expect, it } from 'vitest';
import {
  CURVE_SAMPLES,
  ElementInputSchema,
  curvePoints,
  drawnPoints,
  elementAnchor,
  hitTest,
  LOOT_CATEGORIES,
  LOOT_ITEMS,
  lootIconPath,
  lootItem,
  MARKER_DEFAULT_COLORS,
} from '../src/index.js';

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

const marker = (props: unknown) => ({
  id: '0192f7a1-0000-7000-8000-000000000001',
  boardId: '0192f7a1-0000-7000-8000-000000000002',
  layerId: '0192f7a1-0000-7000-8000-000000000003',
  type: 'MARKER',
  geometry: { at: [100, 100] },
  style: { color: '#38BDF8', width: 4, dashed: false, fillOpacity: 0 },
  props,
});
const MEMBER = '0192f7a1-0000-7000-8000-0000000000aa';

describe('linked own-player markers (Phase 12)', () => {
  it('an own_player marker may carry a member id', () => {
    const ok = ElementInputSchema.safeParse(
      marker({ kind: 'own_player', number: 2, memberId: MEMBER }),
    );
    expect(ok.success).toBe(true);
  });

  it('other kinds may not; the id must be a uuid', () => {
    expect(
      ElementInputSchema.safeParse(marker({ kind: 'enemy_squad', memberId: MEMBER })).success,
    ).toBe(false);
    expect(
      ElementInputSchema.safeParse(marker({ kind: 'own_player', memberId: 'alice' })).success,
    ).toBe(false);
  });
});

describe('curved arrows (Phase 12)', () => {
  const bend = [
    [0, 0],
    [10_000, 10_000],
    [20_000, 0],
  ] as [number, number][];

  it('passes through every stored point, sampled per bend; two points stay straight', () => {
    const c = curvePoints(bend);
    expect(c).toHaveLength(2 * CURVE_SAMPLES + 1);
    expect(c[0]).toEqual([0, 0]);
    expect(c[CURVE_SAMPLES]).toEqual([10_000, 10_000]);
    expect(c.at(-1)).toEqual([20_000, 0]);
    expect(curvePoints(bend.slice(0, 2))).toEqual(bend.slice(0, 2));
  });

  it('is smooth: no sample on the straight chord between bends', () => {
    const c = curvePoints(bend);
    // halfway through the first span the curve bulges above the chord y = x
    const mid = c[CURVE_SAMPLES / 2]!;
    expect(mid[1]).toBeGreaterThan(mid[0]);
  });

  it('only curved ARROWs use the curve — for drawing and for hit-testing', () => {
    const geometry = { points: bend };
    expect(drawnPoints({ type: 'ARROW', geometry })).toBe(bend);
    expect(drawnPoints({ type: 'LINE', geometry, props: { curved: true } })).toBe(bend);
    const curved = drawnPoints({ type: 'ARROW', geometry, props: { curved: true } });
    const mid = curved[CURVE_SAMPLES / 2]!;
    expect(hitTest({ type: 'ARROW', geometry, props: { curved: true } }, mid, 50)).toBe(true);
    // a point on the curve but off the straight segments misses the straight arrow
    expect(hitTest({ type: 'ARROW', geometry }, mid, 50)).toBe(false);
  });

  it('ARROW props accept curved: boolean (strict)', () => {
    const arrow = (props: unknown) => ({
      ...marker({}),
      type: 'ARROW',
      geometry: { points: bend },
      props,
    });
    expect(ElementInputSchema.safeParse(arrow({ curved: true, doubleHeaded: true })).success).toBe(
      true,
    );
    expect(ElementInputSchema.safeParse(arrow({ curved: 1 })).success).toBe(false);
  });
});

describe('loot markers (Phase 12)', () => {
  it("the registry: 80 unique, path-safe ids from PUBG's Assets/Icons, every category used", () => {
    expect(LOOT_ITEMS).toHaveLength(80);
    expect(new Set(LOOT_ITEMS.map((i) => i.id)).size).toBe(80);
    for (const i of LOOT_ITEMS) {
      expect(i.id).toMatch(/^[a-z0-9_]+$/);
      expect(i.source).toMatch(/^Assets\/Icons\/(Item|CarePackage)\/.+\.png$/);
    }
    for (const c of LOOT_CATEGORIES) expect(LOOT_ITEMS.some((i) => i.category === c)).toBe(true);
    expect(lootItem('m416')?.source).toContain('HK416'); // in-game name, PUBG file name
    expect(lootIconPath('awm')).toBe('icons/items/awm.webp');
    expect(MARKER_DEFAULT_COLORS.loot).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('a loot marker takes a known item id only; other kinds take none', () => {
    const parse = (props: unknown) => ElementInputSchema.safeParse(marker(props)).success;
    expect(parse({ kind: 'loot', item: 'awm' })).toBe(true);
    expect(parse({ kind: 'loot' })).toBe(true); // shows the crate
    expect(parse({ kind: 'loot', item: '../../evil' })).toBe(false);
    expect(parse({ kind: 'loot', item: 'https://evil.example/x.png' })).toBe(false);
    expect(parse({ kind: 'drop', item: 'awm' })).toBe(false);
  });
});
