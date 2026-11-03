import { describe, expect, it } from 'vitest';
import { ElementInputSchema } from '../src/index.js';

const arrow = (props: unknown) => ({
  id: '0192f7a1-0000-7000-8000-000000000001',
  boardId: '0192f7a1-0000-7000-8000-000000000002',
  layerId: '0192f7a1-0000-7000-8000-000000000003',
  type: 'ARROW',
  geometry: {
    points: [
      [0, 0],
      [1000, 1000],
    ],
  },
  style: { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 },
  props,
});

describe('ARROW props (Phase 11: double-headed)', () => {
  it('accepts {}, a missing props and doubleHeaded: boolean', () => {
    expect(ElementInputSchema.parse(arrow({})).props).toEqual({});
    expect(ElementInputSchema.parse(arrow(undefined)).props).toEqual({});
    expect(ElementInputSchema.parse(arrow({ doubleHeaded: true })).props).toEqual({
      doubleHeaded: true,
    });
  });

  it('rejects other values and unknown keys (strict)', () => {
    expect(ElementInputSchema.safeParse(arrow({ doubleHeaded: 'yes' })).success).toBe(false);
    expect(ElementInputSchema.safeParse(arrow({ wobbly: true })).success).toBe(false);
  });

  it('other shapes still take no props', () => {
    const line = { ...arrow({ doubleHeaded: true }), type: 'LINE' };
    expect(ElementInputSchema.safeParse(line).success).toBe(false);
  });
});
