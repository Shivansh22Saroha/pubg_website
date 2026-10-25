import type * as RlDebug from './rlDebug';

type RlDebugModule = typeof RlDebug;

/**
 * The `window.__rlDebug` module, or null. The condition sits directly around the import() and
 * both env values are build-time constants (next.config `env`), so production builds without
 * NEXT_PUBLIC_E2E_DEBUG drop the branch — and the debug chunk — entirely.
 */
export function loadDebugHook(): Promise<RlDebugModule> | null {
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_E2E_DEBUG === 'true') {
    return import('./rlDebug');
  }
  return null;
}
