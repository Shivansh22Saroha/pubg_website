import { describe, expect, it } from 'vitest';
import { fillDays, maskEmail } from '../../src/modules/admin/stats.js';

describe('admin stats helpers', () => {
  it('masks emails: two letters, at most four dots, the domain', () => {
    expect(maskEmail('shivansh@gmail.com')).toBe('sh••••@gmail.com');
    expect(maskEmail('averyveryverylongname@x.com')).toBe('av••••@x.com');
    expect(maskEmail('ab@x.io')).toBe('ab•@x.io');
    expect(maskEmail('nope')).toBe('•••');
  });
  it('zero-fills a 30-day series, oldest first', () => {
    const now = new Date('2026-11-12T15:00:00Z');
    const days = fillDays([{ day: new Date('2026-11-10T00:00:00Z'), count: 3n }], now);
    expect(days).toHaveLength(30);
    expect(days[0]?.date).toBe('2026-10-14');
    expect(days.at(-1)).toEqual({ date: '2026-11-12', count: 0 });
    expect(days.at(-3)).toEqual({ date: '2026-11-10', count: 3 });
  });
});
