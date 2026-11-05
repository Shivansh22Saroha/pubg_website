import { create } from 'zustand';

/** a request still pending after this long probably means the free-tier API is cold-starting */
export const SLOW_AFTER_MS = 2500;

interface SlowState {
  /** requests that have been pending longer than SLOW_AFTER_MS */
  slow: number;
}

export const useSlowRequests = create<SlowState>(() => ({ slow: 0 }));

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
