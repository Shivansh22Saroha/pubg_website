import { IceServerSchema, type IceServer } from '@rotationlab/shared';
import { z } from 'zod';

/** Without a relay (or when Cloudflare can't be reached) peers still find direct routes. */
export const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

/** how long one set of relay credentials works — longer than any practice session */
export const TURN_TTL_SEC = 6 * 60 * 60;
const TIMEOUT_MS = 3_000;

const ResponseSchema = z.object({ iceServers: z.array(IceServerSchema).min(1) });

export interface IceProvider {
  /** short-lived ICE servers for one voice join; never throws (falls back to STUN) */
  iceServers(): Promise<IceServer[]>;
  readonly relay: boolean;
}

/**
 * Browsers can't reach port 53, so such URLs only add a timeout to ICE gathering
 * (Cloudflare's docs). Drops them; a server left with no URLs is dropped too.
 */
export function withoutPort53(servers: IceServer[]): IceServer[] {
  const out: IceServer[] = [];
  for (const s of servers) {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
    if (urls.length > 0) out.push({ ...s, urls });
  }
  return out;
}

/**
 * Voice relay credentials (FEATURES F19, SECURITY VC2): a Cloudflare Realtime TURN key lives
 * only on the server; each voice join gets its own credentials that expire after
 * TURN_TTL_SEC. Not configured → STUN only (direct connections, no relay).
 */
export function createIceProvider(opts: {
  keyId: string;
  apiToken: string;
  /** tests: a stub */
  fetch?: typeof fetch;
  onError?: (err: unknown) => void;
}): IceProvider {
  const doFetch = opts.fetch ?? fetch;
  const relay = Boolean(opts.keyId && opts.apiToken);
  return {
    relay,
    async iceServers() {
      if (!relay) return STUN_ONLY;
      try {
        const res = await doFetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(opts.keyId)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${opts.apiToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ ttl: TURN_TTL_SEC }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}`);
        const servers = withoutPort53(ResponseSchema.parse(await res.json()).iceServers);
        return servers.length > 0 ? servers : STUN_ONLY;
      } catch (err) {
        opts.onError?.(err);
        return STUN_ONLY;
      }
    },
  };
}
