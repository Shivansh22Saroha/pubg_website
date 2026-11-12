'use client';

import { useSyncExternalStore } from 'react';

/**
 * UI_UX_SPEC §7 layouts:
 * - `desktop` ≥ 1280: full layout;
 * - `compact` 1024–1279: right panel 300 px, collapsed by default;
 * - `tablet` 768–1023: bottom toolbar, panel as a half-height bottom sheet;
 * - `phone` < 768, or a touch screen held sideways that is under 520 px tall (a phone in
 *   landscape is often 800–930 px wide): every tool, phone chrome.
 */
export type Breakpoint = 'desktop' | 'compact' | 'tablet' | 'phone';

/** a phone held sideways: touch, short, wider than tall (UI_UX_SPEC §7) */
export function isLandscapePhone(width: number, height: number, coarse: boolean): boolean {
  return coarse && height < 520 && width > height && width < 1280;
}

export function breakpointFor(width: number, height = Infinity, coarse = false): Breakpoint {
  if (isLandscapePhone(width, height, coarse)) return 'phone';
  if (width >= 1280) return 'desktop';
  if (width >= 1024) return 'compact';
  if (width >= 768) return 'tablet';
  return 'phone';
}

const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

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
    () => breakpointFor(window.innerWidth, window.innerHeight, coarsePointer()),
    () => 'desktop',
  );
}

/** A phone held sideways: the toolbar moves to the left edge and the top bar slims down. */
export function useLandscapePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isLandscapePhone(window.innerWidth, window.innerHeight, coarsePointer()),
    () => false,
  );
}
