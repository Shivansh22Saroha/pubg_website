import { RoomListResponseSchema } from '@rotationlab/shared';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '@/lib/queryKeys';
import { dehydrated, prefetchApi, type PrefetchContext } from '@/lib/serverApi';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

const ROOMS = { items: [] };

function ctx(res: Response | Error, extra: Partial<PrefetchContext> = {}) {
  const fetchImpl = vi.fn(() =>
    res instanceof Error ? Promise.reject(res) : Promise.resolve(res),
  );
  return {
    fetchImpl,
    ctx: {
      baseUrl: 'http://api:4000/',
      cookie: 'rl_at=tok',
      forwardedFor: '203.0.113.7',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...extra,
    },
  };
}

describe('prefetchApi', () => {
  it('forwards only the given cookie and the client IP, and parses with the schema', async () => {
    const { ctx: c, fetchImpl } = ctx(Response.json(ROOMS));
    await expect(prefetchApi('/rooms', RoomListResponseSchema, c)).resolves.toEqual(ROOMS);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api:4000/api/v1/rooms',
      expect.objectContaining({
        cache: 'no-store',
        headers: { cookie: 'rl_at=tok', 'x-forwarded-for': '203.0.113.7' },
      }),
    );
  });

  it('skips the call without an access cookie', async () => {
    const { ctx: c, fetchImpl } = ctx(Response.json(ROOMS), { cookie: '' });
    await expect(prefetchApi('/rooms', RoomListResponseSchema, c)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a 401', Response.json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, { status: 401 })],
    ['a 500', new Response('oops', { status: 500 })],
    ['a schema mismatch', Response.json({ items: [{ id: 1 }] })],
    ['a non-JSON body', new Response('<html>', { status: 200 })],
    ['a network error', new Error('ECONNREFUSED')],
  ])('returns null on %s (the client then fetches itself)', async (_, res) => {
    const { ctx: c } = ctx(res);
    await expect(prefetchApi('/rooms', RoomListResponseSchema, c)).resolves.toBeNull();
  });
});

describe('dehydrated', () => {
  it('keeps fetched entries and leaves failed ones out', () => {
    const state = dehydrated([
      [keys.rooms, []],
      [['me'], undefined],
    ]);
    expect(state.queries.map((q) => q.queryKey)).toEqual([['rooms']]);
    expect(state.queries[0]?.state.status).toBe('success');
  });
});
