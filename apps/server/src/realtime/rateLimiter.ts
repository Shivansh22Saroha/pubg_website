/**
 * Per-socket token buckets (API_SPEC §7.4). In-memory per connection: a socket lives on one
 * instance, so no shared state is needed for these limits.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export type LimitGroup = 'durable' | 'chat' | 'volatile';

export const SOCKET_LIMITS = {
  durable: { rate: 30, burst: 60 }, // element:* / layer:* (+ control events)
  chat: { rate: 0.5, burst: 5 }, // 5 per 10 s
  volatile: { rate: 40, burst: 40 }, // cursor / laser / stroke:preview / view, combined
  abuse: { violations: 10, windowMs: 60_000 }, // then disconnect
} as const;

export function createSocketLimiter(now: () => number = Date.now) {
  const buckets: Record<LimitGroup, TokenBucket> = {
    durable: new TokenBucket(SOCKET_LIMITS.durable.rate, SOCKET_LIMITS.durable.burst, now),
    chat: new TokenBucket(SOCKET_LIMITS.chat.rate, SOCKET_LIMITS.chat.burst, now),
    volatile: new TokenBucket(SOCKET_LIMITS.volatile.rate, SOCKET_LIMITS.volatile.burst, now),
  };
  const violations: number[] = [];
  return {
    take: (group: LimitGroup) => buckets[group].take(),
    /** records a durable/chat violation; true when the socket should be disconnected */
    violation(): boolean {
      const t = now();
      violations.push(t);
      while (violations.length > 0 && (violations[0] ?? t) < t - SOCKET_LIMITS.abuse.windowMs)
        violations.shift();
      return violations.length >= SOCKET_LIMITS.abuse.violations;
    },
  };
}
