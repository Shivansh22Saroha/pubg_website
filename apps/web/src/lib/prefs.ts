/**
 * Per-device UI conveniences the spec keeps in localStorage (FEATURES F3/F4/F6: labels choice,
 * last board per room, tool styles, marker kind). Never tokens or anything secret — those
 * live in httpOnly cookies only.
 * Every access is wrapped: storage can be missing or throw (private mode, blocked site data).
 */
/* eslint-disable no-restricted-syntax -- the one sanctioned localStorage access point */

const PREFIX = 'rl:pref:';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore: preferences are best-effort
  }
}

export const prefKeys = {
  lastBoard: (roomId: string) => `lastBoard:${roomId}`,
  /** last-used style per drawing tool (FEATURES F6) */
  toolStyles: 'toolStyles',
  /** last marker kind picked in the flyout (FEATURES F6) */
  markerKind: 'markerKind',
  /** arrow tool's double-headed toggle (Phase 11) */
  arrowDoubleHeaded: 'arrowDoubleHeaded',
  /** arrow tool's curved toggle (Phase 12) */
  arrowCurved: 'arrowCurved',
  /** minimap collapsed (Phase 11) */
  minimapCollapsed: 'minimapCollapsed',
} as const;
