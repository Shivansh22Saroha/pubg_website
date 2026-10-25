/**
 * Per-device UI conveniences the spec keeps in localStorage (FEATURES F3/F4: labels choice,
 * last board per room). Never tokens or anything secret — those live in httpOnly cookies only.
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
} as const;
