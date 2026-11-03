import { describe, expect, it } from 'vitest';
import { buildCsp } from '@/lib/csp';

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split('; ').map((d) => {
      const [k = '', ...v] = d.split(' ');
      return [k, v];
    }),
  );

describe('buildCsp', () => {
  it('production: nonce + strict-dynamic, no eval, nothing framed, local tiles add no origin', () => {
    const d = directives(buildCsp({ nonce: 'abc', dev: false, tilesBaseUrl: '/tiles' }));
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(d['connect-src']).toEqual(["'self'"]);
  });

  it('never emits "null" for relative or non-http values', () => {
    for (const tilesBaseUrl of ['/tiles', 'tiles', 'blob:x', 'javascript:alert(1)']) {
      expect(buildCsp({ nonce: 'n', dev: false, tilesBaseUrl, socketUrl: '/x' })).not.toMatch(
        /null|javascript/,
      );
    }
  });

  it('dev adds unsafe-eval', () => {
    expect(buildCsp({ nonce: 'n', dev: true, tilesBaseUrl: '/tiles' })).toContain(
      "'nonce-n' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it('allows the tile CDN, a direct socket URL (http + ws) and the Sentry ingest host', () => {
    const d = directives(
      buildCsp({
        nonce: 'n',
        dev: false,
        tilesBaseUrl: 'https://tiles.example.com/v1',
        socketUrl: 'http://localhost:4200',
        sentryDsn: 'https://key@o1.ingest.sentry.io/42',
      }),
    );
    expect(d['img-src']).toContain('https://tiles.example.com');
    expect(d['connect-src']).toEqual([
      "'self'",
      'https://tiles.example.com',
      'http://localhost:4200',
      'ws://localhost:4200',
      'https://o1.ingest.sentry.io',
    ]);
  });
});
