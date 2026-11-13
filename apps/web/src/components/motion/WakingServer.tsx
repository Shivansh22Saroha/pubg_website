'use client';

import { useSlowRequests } from '@/lib/slowRequests';

/**
 * Free hosting puts the API to sleep when idle; the first request can take up to a minute,
 * hanging or answering 502 while it boots (api.ts retries those). Instead of a page that looks
 * broken, a small radar card explains the wait while any request hangs or retries.
 */
export function WakingServer() {
  const busy = useSlowRequests((s) => s.slow + s.waking);
  if (busy === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="waking-server"
      className="rl-waking glass pointer-events-none fixed bottom-6 left-1/2 z-[1000] flex items-center gap-3 rounded-xl px-4 py-3 shadow-xl"
      style={{ transform: 'translateX(-50%)' }}
    >
      <span className="rl-radar" aria-hidden />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-text">Waking the server…</span>
        <span className="text-xs text-text-muted">
          It naps when nobody is planning. Up to a minute — we&apos;ll retry for you.
        </span>
      </span>
    </div>
  );
}
