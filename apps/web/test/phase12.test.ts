import { describe, expect, it } from 'vitest';
import { elementLocation } from '@/components/tools/ElementList';

const W = 816_000;

describe('element list location (Phase 12)', () => {
  it('grid ref of the element anchor', () => {
    // centre of the map: column E (4th → index 4 starts at 408 000), row M
    expect(elementLocation({ geometry: { at: [408_000, 408_000] } }, W)).toBe('E-M 0,0');
    expect(elementLocation({ geometry: { center: [1, 1], r: 500 } }, W)).toBe('A-I 0,0');
    expect(elementLocation({ geometry: {} }, W)).toBe('');
  });
});
