import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/** A redeemed ticket: who opened the socket, and when their access token runs out. */
export interface SocketTicketClaims {
  userId: string;
  sid: string;
  /** the access token's expiry, epoch seconds (the socket's session-expiry timer uses it) */
  exp: number;
}

/** short enough that a leaked ticket is useless almost at once; the client fetches one per connect */
export const SOCKET_TICKET_TTL_SEC = 60;
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;
const key = (raw: string) => `rt:ticket:${createHash('sha256').update(raw).digest('hex')}`;

export interface SocketTickets {
  issue(claims: SocketTicketClaims): Promise<string>;
  /** single use: the ticket is deleted as it is read (GETDEL). Null when unknown or malformed. */
  redeem(raw: unknown): Promise<SocketTicketClaims | null>;
}

/**
 * Socket tickets (SECURITY A11, API_SPEC §7.1). When the web app and the API live on different
 * sites (e.g. Vercel + Render), the access cookie is first-party to the web origin only — REST
 * reaches the API through the web origin's rewrite, but a websocket can't be rewritten there.
 * The client asks for a ticket over that same-origin REST path and hands it to the handshake.
 * 256-bit random, stored only as a SHA-256 hash, 60 s, single use.
 */
export function createSocketTickets(redis: Redis): SocketTickets {
  return {
    async issue(claims) {
      const raw = randomBytes(32).toString('base64url');
      await redis.set(key(raw), JSON.stringify(claims), 'EX', SOCKET_TICKET_TTL_SEC);
      return raw;
    },
    async redeem(raw) {
      if (typeof raw !== 'string' || !TICKET_RE.test(raw)) return null;
      const stored = await redis.getdel(key(raw));
      if (!stored) return null;
      try {
        const v = JSON.parse(stored) as Partial<SocketTicketClaims>;
        if (typeof v.userId !== 'string' || typeof v.sid !== 'string' || typeof v.exp !== 'number')
          return null;
        return { userId: v.userId, sid: v.sid, exp: v.exp };
      } catch {
        return null;
      }
    },
  };
}
