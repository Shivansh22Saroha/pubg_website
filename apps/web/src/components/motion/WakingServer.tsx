'use client';

import { useSlowRequests } from '@/lib/slowRequests';

/**
 * Free hosting puts the API to sleep when idle; the first request can take ~30 s. Instead of a
 * page that looks broken, a small radar card explains the wait while any request hangs.
 */
export function WakingServer() {
  const slow = useSlowRequests((s) => s.slow);
  if (slow === 0) return null;
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
          It naps when nobody is planning. Up to 30 s.
        </span>
      </span>
    </div>
  );
}
