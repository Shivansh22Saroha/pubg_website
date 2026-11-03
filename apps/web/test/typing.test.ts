import { describe, expect, it } from 'vitest';
import {
  TYPING_TTL_MS,
  typingLabel,
  typingPruned,
  typingSeen,
  typingStopped,
} from '@/stores/typingModel';

describe('typing indicator model (Phase 11)', () => {
  it('a user counts as typing for 4 s after their last event; a new event extends it', () => {
    let m = typingSeen({}, 'a', 1_000);
    expect(m).toEqual({ a: 1_000 + TYPING_TTL_MS });
    m = typingSeen(m, 'a', 3_000);
    expect(typingPruned(m, 6_000)).toEqual({ a: 7_000 });
    expect(typingPruned(m, 7_000)).toEqual({});
  });

  it('their message clears them at once; pruning without changes keeps the same object', () => {
    const m = typingSeen(typingSeen({}, 'a', 0), 'b', 0);
    expect(Object.keys(typingStopped(m, 'a'))).toEqual(['b']);
    expect(typingStopped(m, 'zz')).toBe(m);
    expect(typingPruned(m, 1)).toBe(m);
  });

  it('labels one, two or several typists', () => {
    expect(typingLabel([])).toBe('');
    expect(typingLabel(['Rudra'])).toBe('Rudra is typing…');
    expect(typingLabel(['A', 'B'])).toBe('A and B are typing…');
    expect(typingLabel(['A', 'B', 'C'])).toBe('Several people are typing…');
  });
});
