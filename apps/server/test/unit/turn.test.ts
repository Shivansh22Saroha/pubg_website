import { describe, expect, it, vi } from 'vitest';
import {
  createIceProvider,
  STUN_ONLY,
  TURN_TTL_SEC,
  withoutPort53,
} from '../../src/modules/voice/turn.js';

const CF = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u',
      credential: 'c',
    },
  ],
};

const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify(CF), { status: 201 })) as unknown as typeof fetch;

describe('voice relay credentials', () => {
  it('without a key: STUN only, no request', async () => {
    const f = okFetch();
    const p = createIceProvider({ keyId: '', apiToken: '', fetch: f });
    expect(p.relay).toBe(false);
    expect(await p.iceServers()).toEqual(STUN_ONLY);
    expect(f).not.toHaveBeenCalled();
  });

  it('asks Cloudflare for short-lived credentials with the server-side token', async () => {
    const f = okFetch();
    const p = createIceProvider({ keyId: 'key/1', apiToken: 'secret', fetch: f });
    const servers = await p.iceServers();
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key%2F1/credentials/generate-ice-servers',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ ttl: TURN_TTL_SEC });
    // port 53 is unreachable from browsers: dropped
    expect(servers).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'u',
        credential: 'c',
      },
    ]);
  });

  it('falls back to STUN (and reports) when Cloudflare fails or answers nonsense', async () => {
    for (const f of [
      vi.fn(async () => new Response('nope', { status: 401 })),
      vi.fn(async () => new Response(JSON.stringify({ iceServers: 'x' }), { status: 201 })),
      vi.fn(async () => {
        throw new Error('network');
      }),
    ]) {
      const onError = vi.fn();
      const p = createIceProvider({
        keyId: 'k',
        apiToken: 't',
        fetch: f,
        onError,
      });
      expect(await p.iceServers()).toEqual(STUN_ONLY);
      expect(onError).toHaveBeenCalledOnce();
    }
  });

  it('withoutPort53 drops servers left with no URLs', () => {
    expect(withoutPort53([{ urls: 'stun:x:53' }, { urls: 'stun:y:3478' }])).toEqual([
      { urls: ['stun:y:3478'] },
    ]);
  });
});
