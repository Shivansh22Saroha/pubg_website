/**
 * Follow mode (FEATURES F8) as a reducer: state transitions plus the effects they cause
 * (socket emits, toasts). The store runs the effects; tests check them as data.
 */

export interface FollowState {
  /** the user being followed, or null */
  leaderId: string | null;
  /** came from a summon (a "Don't follow" stop is silent) */
  summoned: boolean;
}

export type FollowAction =
  | { type: 'start'; leaderId: string; summoned?: boolean }
  /** the Stop button / "Don't follow" / leaving the room — no toast */
  | { type: 'stop' }
  /** any pan / zoom the follower makes themselves */
  | { type: 'manualMove' }
  /** presence: who is online now (the leader left or disconnected?) */
  | { type: 'presence'; online: ReadonlySet<string> };

export type FollowEffect =
  | { kind: 'emitStart'; leaderId: string }
  | { kind: 'emitStop'; leaderId: string }
  | { kind: 'toast'; message: string };

export const idleFollow: FollowState = { leaderId: null, summoned: false };

export function reduceFollow(
  s: FollowState,
  a: FollowAction,
  ctx: { meId: string; nameOf: (userId: string) => string },
): { state: FollowState; effects: FollowEffect[] } {
  const stop = (toast?: string) => ({
    state: idleFollow,
    effects: [
      ...(s.leaderId ? [{ kind: 'emitStop', leaderId: s.leaderId } as const] : []),
      ...(toast ? [{ kind: 'toast', message: toast } as const] : []),
    ],
  });
  switch (a.type) {
    case 'start': {
      if (a.leaderId === ctx.meId || a.leaderId === s.leaderId) return { state: s, effects: [] };
      const effects: FollowEffect[] = [];
      if (s.leaderId) effects.push({ kind: 'emitStop', leaderId: s.leaderId });
      effects.push({ kind: 'emitStart', leaderId: a.leaderId });
      return { state: { leaderId: a.leaderId, summoned: a.summoned ?? false }, effects };
    }
    case 'stop':
      return s.leaderId ? stop() : { state: s, effects: [] };
    case 'manualMove':
      return s.leaderId ? stop('Stopped following') : { state: s, effects: [] };
    case 'presence':
      if (!s.leaderId || a.online.has(s.leaderId)) return { state: s, effects: [] };
      return stop(`${ctx.nameOf(s.leaderId)} left — stopped following`);
  }
}
