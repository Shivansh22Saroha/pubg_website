/**
 * Typing indicator (Phase 11, FEATURES F9): who is typing in the room chat. Pure rules; the
 * Zustand store and the session wire them up.
 */

/** a client sends `chat:typing` at most this often while the user types */
export const TYPING_SEND_MS = 2_000;
/** someone counts as typing for this long after their last `chat:typing` */
export const TYPING_TTL_MS = 4_000;

/** userId → time (ms) after which they no longer count as typing */
export type TypingMap = Record<string, number>;

export function typingSeen(m: TypingMap, userId: string, now: number): TypingMap {
  return { ...m, [userId]: now + TYPING_TTL_MS };
}

export function typingStopped(m: TypingMap, userId: string): TypingMap {
  if (!(userId in m)) return m;
  const { [userId]: _gone, ...rest } = m;
  return rest;
}

export function typingPruned(m: TypingMap, now: number): TypingMap {
  const kept = Object.entries(m).filter(([, until]) => until > now);
  return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept);
}

/** "Rudra is typing…", "A and B are typing…", "Several people are typing…" */
export function typingLabel(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}
