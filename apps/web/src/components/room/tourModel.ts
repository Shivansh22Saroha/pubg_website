/**
 * Coach-mark tour of the room (UF-3 step 4, UI_UX_SPEC §9): toolbar → board tabs → Invite.
 * Steps whose anchor isn't on screen (a viewer has no Invite) are skipped. Pure, so the state
 * machine is unit-tested; RoomTour renders it.
 */
export type TourAnchor = 'toolbar' | 'board-tabs' | 'invite';

export interface TourStep {
  anchor: TourAnchor;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    anchor: 'toolbar',
    title: 'Your tools',
    body: 'Pick a tool to draw, drop markers or measure. Everything you draw shows up for the squad at once.',
  },
  {
    anchor: 'board-tabs',
    title: 'Boards',
    body: 'Each board is one plan on one map. Switch between them here; the ⋯ menu has snapshots.',
  },
  {
    anchor: 'invite',
    title: 'Invite your squad',
    body: 'Share a link or code so teammates can join and plan with you live.',
  },
];

export type TourState =
  | { status: 'idle' }
  | { status: 'running'; steps: readonly TourStep[]; index: number }
  | { status: 'done' };

export type TourAction =
  | { type: 'start'; available: ReadonlySet<TourAnchor> }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'dismiss' };

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start': {
      if (state.status !== 'idle') return state;
      const steps = TOUR_STEPS.filter((s) => action.available.has(s.anchor));
      return steps.length === 0 ? { status: 'done' } : { status: 'running', steps, index: 0 };
    }
    case 'next':
      if (state.status !== 'running') return state;
      return state.index + 1 >= state.steps.length
        ? { status: 'done' }
        : { ...state, index: state.index + 1 };
    case 'back':
      if (state.status !== 'running') return state;
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'dismiss':
      return state.status === 'running' ? { status: 'done' } : state;
  }
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where the coach card goes: below the anchor when it fits, else above, else beside it (a
 * left toolbar column); always inside the viewport with an 8 px margin.
 */
export function placeCard(
  anchor: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 12,
): { top: number; left: number } {
  const clampX = (x: number) => Math.max(8, Math.min(x, viewport.width - card.width - 8));
  const clampY = (y: number) => Math.max(8, Math.min(y, viewport.height - card.height - 8));
  const tall = anchor.height > viewport.height / 2;
  if (tall) return { top: clampY(anchor.top + 8), left: clampX(anchor.left + anchor.width + gap) };
  const below = anchor.top + anchor.height + gap;
  if (below + card.height <= viewport.height - 8) return { top: below, left: clampX(anchor.left) };
  return { top: clampY(anchor.top - gap - card.height), left: clampX(anchor.left) };
}
