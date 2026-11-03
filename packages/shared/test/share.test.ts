import { describe, expect, it } from 'vitest';
import {
  CreateShareLinkBodySchema,
  SharedBoardResponseSchema,
  ShareTokenParamsSchema,
  ShareTokenSchema,
  shareUrl,
} from '../src/index.js';

describe('share link schemas (Phase 11)', () => {
  it('accepts a 22-char base64url token (128 bits) and nothing else', () => {
    expect(ShareTokenSchema.safeParse('AbCdEfGhIjKlMnOpQr_-12').success).toBe(true);
    for (const bad of ['', 'short', 'A'.repeat(21), 'A'.repeat(23), 'AbCdEfGhIjKlMnOpQr+/12'])
      expect(ShareTokenSchema.safeParse(bad).success, bad).toBe(false);
    expect(ShareTokenParamsSchema.safeParse({ token: 'A'.repeat(22), x: 1 }).success).toBe(false);
  });

  it('only offers the listed expiries, strictly', () => {
    expect(CreateShareLinkBodySchema.safeParse({ expiresIn: '7d' }).success).toBe(true);
    expect(CreateShareLinkBodySchema.safeParse({ expiresIn: '1y' }).success).toBe(false);
    expect(CreateShareLinkBodySchema.safeParse({ expiresIn: '7d', boardId: 'x' }).success).toBe(
      false,
    );
  });

  it('the public board has no room id and only null author ids', () => {
    const board = {
      id: '0192f7a1-0000-7000-8000-000000000001',
      name: 'Plan',
      mapId: 'erangel',
      position: 0,
      elementCount: 0,
      updatedAt: '2026-11-03T10:00:00.000Z',
    };
    const ok = { board, layers: [], elements: [], expiresAt: null };
    expect(SharedBoardResponseSchema.parse(ok).board).not.toHaveProperty('roomId');
    const leaky = SharedBoardResponseSchema.parse({
      ...ok,
      board: { ...board, roomId: '0192f7a1-0000-7000-8000-000000000002' },
    });
    // the schema strips unknown keys, so a leak can't survive serialisation
    expect(leaky.board).not.toHaveProperty('roomId');
  });

  it('builds the /s/<token> URL on the app origin', () => {
    expect(shareUrl('https://app.example.com/', 'A'.repeat(22))).toBe(
      `https://app.example.com/s/${'A'.repeat(22)}`,
    );
  });
});
