'use client';

import { MAPS } from '@rotationlab/shared';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useSharedBoard } from '@/lib/share';
import { MEASURE_HINT, MeasureButton, useMeasureToggle } from './MeasureToggle';

// the same read-only map as /explore: tiles, grid, labels, StaticElements, local measure
const ExploreMap = dynamic(() => import('./ExploreMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-text-muted">Loading map…</div>
  ),
});

const MESSAGES = {
  gone: 'This link is invalid or has expired. Ask whoever shared it for a new one.',
  limited: 'Too many requests from your network — try again in a minute.',
  error: 'The board could not be loaded. Check your connection and reload.',
} as const;

/**
 * `/s/[token]` (FEATURES F4b): one board as it is right now. No socket and no live updates
 * (reload for the latest), nothing that edits; labels / grid (HUD, N / Shift+G) and Measure
 * (R) work. The page never learns which room or which people made it.
 */
export function SharedBoardView({ token }: { token: string }) {
  const shared = useSharedBoard(token);
  const [measuring, setMeasuring] = useMeasureToggle();
  const result = shared.data;
  const board = result?.status === 'ok' ? result.board : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b bg-bg px-4 py-2">
        <h1 className="truncate text-sm font-medium" data-testid="shared-board-name">
          {board ? `${board.name} · ${MAPS[board.mapId].name}` : 'Shared board'}
        </h1>
        {board && (
          <MeasureButton
            measuring={measuring}
            testId="shared-measure"
            onToggle={() => {
              setMeasuring((m) => !m);
            }}
          />
        )}
        <p className="w-full text-xs text-text-muted" aria-live="polite">
          {measuring
            ? MEASURE_HINT
            : board
              ? 'Read-only snapshot of the board as it is now — reload for the latest.'
              : ''}
        </p>
      </div>

      <main className="relative min-h-0 flex-1" aria-label="Map" data-testid="shared-map">
        {shared.isPending && (
          <div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
        )}
        {result && result.status !== 'ok' && (
          <div
            role="alert"
            data-testid="shared-error"
            className="flex h-full items-center justify-center px-4 text-center text-sm text-text-muted"
          >
            {MESSAGES[result.status]}
          </div>
        )}
        {board && <ExploreMap board={board} measuring={measuring} />}
      </main>

      <aside
        aria-label="Sign up"
        className="flex flex-wrap items-center justify-center gap-3 border-t bg-surface px-4 py-3 text-sm"
      >
        <p>Plan your own rotations with your squad</p>
        <Link href="/register" className={buttonVariants({ size: 'sm' })}>
          Create account
        </Link>
      </aside>
    </>
  );
}
