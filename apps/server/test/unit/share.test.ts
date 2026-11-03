import { describe, expect, it } from 'vitest';
import { maskUrl } from '../../src/app.js';
import { SHARE_EXPIRY_MS } from '../../src/modules/share/service.js';
import { SHARE_EXPIRY } from '@rotationlab/shared';

describe('share links (Phase 11)', () => {
  it('masks the token in logged URLs, keeping everything else', () => {
    expect(maskUrl('/api/v1/public/share/AbCdEfGhIjKlMnOpQr_-12')).toBe(
      '/api/v1/public/share/[redacted]',
    );
    expect(maskUrl('/api/v1/public/share/abc?x=1')).toBe('/api/v1/public/share/[redacted]?x=1');
    expect(maskUrl('/api/v1/boards/123/share')).toBe('/api/v1/boards/123/share');
  });

  it('has a duration for every offered expiry', () => {
    for (const e of SHARE_EXPIRY) expect(SHARE_EXPIRY_MS).toHaveProperty(e);
    expect(SHARE_EXPIRY_MS.never).toBeNull();
    expect(SHARE_EXPIRY_MS['30d']).toBe(30 * 86_400_000);
  });
});
