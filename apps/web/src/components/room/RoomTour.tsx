'use client';

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMe } from '@/hooks/useMe';
import { useUpdatePrefs } from '@/lib/account';
import { placeCard, tourReducer, type Rect, type TourAnchor } from './tourModel';

const anchorEl = (a: TourAnchor) => document.querySelector<HTMLElement>(`[data-tour="${a}"]`);

/**
 * First-visit coach marks (UF-3 step 4): toolbar → board tabs → Invite. Dismissible (Skip, Esc);
 * finishing or skipping is stored server-side (`PATCH /me/prefs`), so it never repeats — not
 * after a reload, not on another device. Non-modal: the room stays usable behind it.
 */
export function RoomTour({ enabled }: { enabled: boolean }) {
  const me = useMe();
  const prefs = useUpdatePrefs();
  const [state, dispatch] = useReducer(tourReducer, { status: 'idle' });
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const due = enabled && me.data !== undefined && !me.data.prefs.roomTourDone;

  // start once the anchors are on screen (after the room's first paint)
  useEffect(() => {
    if (!due || state.status !== 'idle') return;
    const frame = requestAnimationFrame(() => {
      const available = new Set<TourAnchor>(
        (['toolbar', 'board-tabs', 'invite'] as const).filter((a) => anchorEl(a)),
      );
      returnFocus.current = document.activeElement as HTMLElement | null;
      dispatch({ type: 'start', available });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [due, state.status]);

  const step = state.status === 'running' ? state.steps[state.index] : undefined;

  // follow the anchor (resizes, layout changes)
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const r = anchorEl(step.anchor)?.getBoundingClientRect();
      setRect(r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!rect || !card) return;
    setPos(
      placeCard(
        rect,
        { width: card.offsetWidth, height: card.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [rect]);

  // focus the card's primary action on every step
  useEffect(() => {
    if (step) cardRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus();
  }, [step]);

  // done (finished or dismissed): remember it, hand focus back
  const persisted = useRef(false);
  useEffect(() => {
    if (state.status !== 'done' || persisted.current) return;
    persisted.current = true;
    prefs.mutate({ roomTourDone: true });
    returnFocus.current?.focus();
  }, [state.status, prefs]);

  if (state.status !== 'running' || !step) return null;
  const last = state.index === state.steps.length - 1;

  return (
    <>
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1800] rounded-panel ring-2 ring-accent ring-offset-2 ring-offset-bg"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="room-tour"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            dispatch({ type: 'dismiss' });
          }
        }}
        style={pos ?? { top: -9999, left: -9999 }}
        className="fixed z-[1900] w-72 max-w-[calc(100vw-16px)] rounded-panel panel-hard bg-surface p-4"
      >
        <p className="text-xs text-text-muted">
          Step {state.index + 1} of {state.steps.length}
        </p>
        <h2 id="tour-title" className="mt-1 font-display text-lg font-bold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1 text-sm text-text-muted">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dispatch({ type: 'dismiss' });
            }}
          >
            Skip tour
          </Button>
          <span className="ml-auto" />
          {state.index > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatch({ type: 'back' });
              }}
            >
              Back
            </Button>
          )}
          <Button
            size="sm"
            data-primary=""
            onClick={() => {
              dispatch({ type: 'next' });
            }}
          >
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </>
  );
}
