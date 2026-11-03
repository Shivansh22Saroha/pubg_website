import { describe, expect, it } from 'vitest';
import { ElementInputSchema, elementAnchor } from '../src/index.js';

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
