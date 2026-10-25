export const DEFAULT_AFTER_LOGIN = '/dashboard';

const AUTH_PAGES = ['/login', '/register'];

/**
 * Only same-site relative paths: a single leading "/", no "//" or "/\" (protocol-relative),
 * no backslashes or control characters, and never back to an auth page (loop).
 */
export function safeRedirect(value: unknown, fallback = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // backslash or C0/DEL control characters — rejecting them is the point
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001F\u007F]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, 'http://same.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'http://same.invalid') return fallback;
  if (AUTH_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)))
    return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
