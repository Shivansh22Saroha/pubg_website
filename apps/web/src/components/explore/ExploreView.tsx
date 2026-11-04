'use client';

import { MAPS } from '@rotationlab/shared';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { exploreBoards, useDemoBoards } from '@/lib/explore';
import { cn } from '@/lib/utils';
import { MEASURE_HINT, MeasureButton, useMeasureToggle } from './MeasureToggle';

// Leaflet touches `window` at import time → client-only, and kept out of every other bundle.
const ExploreMap = dynamic(() => import('./ExploreMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-text-muted">Loading map…</div>
  ),
});

/**
 * `/explore` (FEATURES F13, UF-9): the demo boards read-only, no login and no socket. A map
 * switcher, labels / grid (map HUD, N / Shift+G) and the local measure tool (R) — nothing that
 * edits.
 */
export function ExploreView() {
  const demo = useDemoBoards();
  const boards = useMemo(() => exploreBoards(demo.data ?? []), [demo.data]);
  const [index, setIndex] = useState(0);
  const [measuring, setMeasuring] = useMeasureToggle();
  const board = boards[index] ?? boards[0];
  const bare = demo.isSuccess && demo.data.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b bg-bg px-4 py-2">
        <div role="group" aria-label="Map" className="flex gap-1">
          {boards.map((b, i) => (
            <button
              key={b.mapId}
              type="button"
              aria-pressed={i === index}
              data-testid={`explore-map-${b.mapId}`}
              onClick={() => {
                setIndex(i);
              }}
              className={cn(
                'h-9 rounded-control px-3 text-[13px] font-medium text-text-muted pointer-coarse:h-11',
                'hover:bg-surface-2 hover:text-text',
                i === index && 'bg-surface-2 text-text shadow-[inset_0_-3px_0_var(--accent)]',
              )}
            >
              {MAPS[b.mapId].name}
            </button>
          ))}
        </div>
        <MeasureButton
          measuring={measuring}
          testId="explore-measure"
          onToggle={() => {
            setMeasuring((m) => !m);
          }}
        />
        <p className="w-full text-xs text-text-muted" aria-live="polite">
          {measuring
            ? MEASURE_HINT
            : bare
              ? 'No demo boards are set up here — showing the bare maps.'
              : board?.name
                ? `${board.name} · read-only demo`
                : ''}
        </p>
      </div>

      <main className="relative min-h-0 flex-1" aria-label="Map" data-testid="explore-map">
        {board && <ExploreMap key={board.mapId} board={board} measuring={measuring} />}
      </main>

      <aside
        aria-label="Sign up"
        className="flex flex-wrap items-center justify-center gap-3 border-t bg-surface px-4 py-3 text-sm"
      >
        <p>Create a free account to save your own boards</p>
        <Link href="/register" className={buttonVariants({ size: 'sm' })}>
          Create account
        </Link>
      </aside>
    </>
  );
}
