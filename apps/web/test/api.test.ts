import { UserResponseSchema } from '@rotationlab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';

const ME = {
  user: {
    id: '0192f7a1-0000-7000-8000-000000000001',
    username: 'alice',
    displayName: 'Alice',
    ign: null,
    avatarColor: '#38BDF8',
    email: 'alice@example.com',
    emailVerified: false,
    createdAt: '2026-10-25T07:10:00.000Z',
    prefs: { roomTourDone: false },
    isAdmin: false,
    hasPassword: true,
  },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string) =>
  json(status, { error: { code, message: code, requestId: 'r' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api()', () => {
  it('sends credentials, the CSRF header and JSON; never touches storage', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, ME)));
    vi.stubGlobal('fetch', fetchMock);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await api('/me', { method: 'PATCH', body: { ign: 'x' }, schema: UserResponseSchema });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({
      'x-requested-with': 'rotationlab',
      'content-type': 'application/json',
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it.each(['TOKEN_EXPIRED', 'UNAUTHENTICATED'])(
    'on 401 %s refreshes once and retries',
    async (code) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(err(401, code))
        .mockResolvedValueOnce(new Response(null, { status: 204 })) // /auth/refresh
        .mockResolvedValueOnce(json(200, ME));
      vi.stubGlobal('fetch', fetchMock);
      const res = await api('/me', { schema: UserResponseSchema });
      expect(res.user.username).toBe('alice');
      expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual([
        '/api/v1/me',
        '/api/v1/auth/refresh',
        '/api/v1/me',
      ]);
    },
  );

  it('shares ONE refresh call between concurrent 401s', async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/v1/auth/refresh') {
          refreshCalls++;
          return new Promise((r) => {
            setTimeout(() => {
              r(new Response(null, { status: 204 }));
            }, 20);
          });
        }
        meCalls++;
        return Promise.resolve(meCalls <= 3 ? err(401, 'TOKEN_EXPIRED') : json(200, ME));
      }),
    );
    const results = await Promise.all(
      [1, 2, 3].map(() => api('/me', { schema: UserResponseSchema })),
    );
    expect(results.every((r) => r.user.id === ME.user.id)).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(6);
  });

  it('treats 409 from refresh (another tab refreshed) as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(err(401, 'TOKEN_EXPIRED'))
        .mockResolvedValueOnce(err(409, 'CONFLICT'))
        .mockResolvedValueOnce(json(200, ME)),
    );
    await expect(api('/me', { schema: UserResponseSchema })).resolves.toEqual(ME);
  });

  it('gives up after a failed refresh and surfaces the 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(err(401, 'TOKEN_EXPIRED'))
      .mockResolvedValueOnce(err(401, 'UNAUTHENTICATED'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/me', { schema: UserResponseSchema })).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never tries to refresh for /auth/* calls (no loops)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(err(401, 'INVALID_CREDENTIALS')));
    vi.stubGlobal('fetch', fetchMock);
    const e = await api('/auth/login', { method: 'POST', body: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('INVALID_CREDENTIALS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to ApiError NETWORK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(api('/me')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
