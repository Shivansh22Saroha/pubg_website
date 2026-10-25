import { describe, expect, it } from 'vitest';
import { safeRedirect } from '@/lib/redirect';

describe('safeRedirect', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/rooms/abc?board=2#x', '/rooms/abc?board=2#x'],
    ['/join/7KQ2M9XFAP', '/join/7KQ2M9XFAP'],
  ])('keeps same-site path %s', (input, out) => {
    expect(safeRedirect(input)).toBe(out);
  });

  it.each([
    undefined,
    null,
    ['/a', '/b'],
    '',
    'dashboard',
    'https://evil.example/x',
    '//evil.example/x',
    '/\\evil.example',
    '/\\/evil.example',
    '\\\\evil.example',
    '/%0d%0aSet-Cookie:x', // encoded is fine as text, but raw control chars are not:
    '/x\u0000y',
    '/x\ny',
    'javascript:alert(1)',
    '/login',
    '/login?redirectTo=/login',
    '/register',
    `/${'a'.repeat(3000)}`,
  ])('falls back for %s', (input) => {
    const out = safeRedirect(input);
    if (input === '/%0d%0aSet-Cookie:x') {
      expect(out).toBe('/%0d%0aSet-Cookie:x'); // stays a harmless encoded path
    } else {
      expect(out).toBe('/dashboard');
    }
  });

  it('honours a custom fallback', () => {
    expect(safeRedirect('//x', '/')).toBe('/');
  });
});
