'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { prefersReducedMotion } from '@/lib/motion';
import { useFxStore } from '@/stores/fxStore';

/** Switching boards: the map wipes in from the left (skipped on first mount). */
export function BoardTransition({ boardId }: { boardId: string }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    const el = map.getContainer();
    el.classList.remove('rl-board-enter');
    el.getBoundingClientRect(); // restart the animation on quick successive switches
    el.classList.add('rl-board-enter');
    const done = () => {
      el.classList.remove('rl-board-enter');
    };
    el.addEventListener('animationend', done, { once: true });
    return () => {
      el.removeEventListener('animationend', done);
    };
  }, [map, boardId]);
  return null;
}

/** Snapshot restore: a rewind mark spins once over the map. */
export function RewindFlash() {
  const rewind = useFxStore((s) => s.rewind);
  if (rewind === 0 || prefersReducedMotion()) return null;
  return (
    <div
      key={rewind}
      aria-hidden
      data-testid="rewind-flash"
      className="rl-rewind pointer-events-none absolute inset-0 z-[600] flex items-center justify-center"
    >
      <span className="glass flex h-20 w-20 items-center justify-center rounded-full">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
      </span>
    </div>
  );
}
