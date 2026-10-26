'use client';

import { useSyncExternalStore } from 'react';

/**
 * UI_UX_SPEC §7 layouts:
 * - `desktop` ≥ 1280: full layout;
 * - `compact` 1024–1279: right panel 300 px, collapsed by default;
 * - `tablet` 768–1023: bottom toolbar, panel as a half-height bottom sheet;
 * - `phone` < 768: view + chat mode.
 */
export type Breakpoint = 'desktop' | 'compact' | 'tablet' | 'phone';

export function breakpointFor(width: number): Breakpoint {
  if (width >= 1280) return 'desktop';
  if (width >= 1024) return 'compact';
  if (width >= 768) return 'tablet';
  return 'phone';
}

/** tablet and phone share the touch-first chrome: bottom toolbar, sheets, chat button */
export const isTouchLayout = (bp: Breakpoint) => bp === 'tablet' || bp === 'phone';

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
  };
}

/** The current breakpoint; `desktop` during SSR (the room and settings render client-side). */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(
    subscribe,
    () => breakpointFor(window.innerWidth),
    () => 'desktop',
  );
}
