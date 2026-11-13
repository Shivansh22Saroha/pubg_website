import { UserResponseSchema } from '@rotationlab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isWakingResponse, WAKE_MAX_MS } from '@/lib/api';
import { useSlowRequests } from '@/lib/slowRequests';

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

const html = (status: number) =>
  new Response('<!doctype html><title>502</title>', {
    status,
    headers: { 'content-type': 'text/html' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useSlowRequests.setState({ slow: 0, waking: 0 });
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

  describe('while the API is booting (free-tier cold start)', () => {
    it('recognises host 502/503/504 pages but never our own JSON errors', () => {
      expect(isWakingResponse(html(502))).toBe(true);
      expect(isWakingResponse(html(503))).toBe(true);
      expect(isWakingResponse(html(504))).toBe(true);
      expect(isWakingResponse(err(503, 'SERVICE_UNAVAILABLE'))).toBe(false);
      expect(isWakingResponse(html(500))).toBe(false);
      expect(isWakingResponse(json(200, ME))).toBe(false);
    });

    it('retries until the API answers, showing the waking card meanwhile', async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(html(502))
        .mockResolvedValueOnce(html(503))
        .mockResolvedValueOnce(json(200, ME));
      vi.stubGlobal('fetch', fetchMock);
      const p = api('/me', { schema: UserResponseSchema });
      await vi.advanceTimersByTimeAsync(0);
      expect(useSlowRequests.getState().waking).toBe(1);
      await vi.advanceTimersByTimeAsync(5000);
      const res = await p;
      expect(res.user.username).toBe('alice');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(useSlowRequests.getState().waking).toBe(0);
    });

    it('retries writes too — a gateway page means the request never reached the API', async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(html(502))
        .mockResolvedValueOnce(json(200, ME));
      vi.stubGlobal('fetch', fetchMock);
      const p = api('/me', { method: 'PATCH', body: { ign: 'x' }, schema: UserResponseSchema });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(p).resolves.toMatchObject({ user: { username: 'alice' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry our own 503 JSON error', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(err(503, 'SERVICE_UNAVAILABLE')));
      vi.stubGlobal('fetch', fetchMock);
      await expect(api('/me')).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives up after WAKE_MAX_MS with a clear NETWORK error', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(() => Promise.resolve(html(502)));
      vi.stubGlobal('fetch', fetchMock);
      const p = api('/me').catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(WAKE_MAX_MS + 6000);
      const e = await p;
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('NETWORK');
      expect(useSlowRequests.getState().waking).toBe(0);
    });

    it('stops retrying when the caller aborts', async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(html(502))),
      );
      const ac = new AbortController();
      const p = api('/me', { signal: ac.signal }).catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(500);
      ac.abort();
      const e = await p;
      expect((e as DOMException).name).toBe('AbortError');
      expect(useSlowRequests.getState().waking).toBe(0);
    });
  });
});
