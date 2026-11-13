import { create } from 'zustand';

/** a request still pending after this long probably means the free-tier API is cold-starting */
export const SLOW_AFTER_MS = 2500;

interface SlowState {
  /** requests that have been pending longer than SLOW_AFTER_MS */
  slow: number;
  /** requests retrying because the host answered "not running yet" (see api.ts) */
  waking: number;
}

export const useSlowRequests = create<SlowState>(() => ({ slow: 0, waking: 0 }));

/**
 * Wraps a request so a "waking the server" card can appear while it hangs. Pure bookkeeping:
 * the promise is returned untouched.
 */
export function trackSlow<T>(promise: Promise<T>): Promise<T> {
  let counted = false;
  const timer = setTimeout(() => {
    counted = true;
    useSlowRequests.setState((s) => ({ slow: s.slow + 1 }));
  }, SLOW_AFTER_MS);
  const settle = () => {
    clearTimeout(timer);
    if (counted) useSlowRequests.setState((s) => ({ slow: Math.max(0, s.slow - 1) }));
  };
  promise.then(settle, settle);
  return promise;
}

/** Marks one request as waiting for the API to boot; call the returned function when done. */
export function markWaking(): () => void {
  useSlowRequests.setState((s) => ({ waking: s.waking + 1 }));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    useSlowRequests.setState((s) => ({ waking: Math.max(0, s.waking - 1) }));
  };
}
