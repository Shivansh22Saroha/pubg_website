'use client';

import { formatMetres } from '@rotationlab/shared';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { focusedRoute } from '@/lib/focusedRoute';
import { compassPoint, type RouteOption } from '@/lib/plans';
import { useBoardStore } from '@/stores/boardStore';
import { usePlanStore } from '@/stores/planStore';
import { useSelectionStore } from '@/stores/selectionStore';

const CELL_DEG = 15;
const CELL_PX = 30;
/** two full turns of 15° cells, so any bearing can sit in the middle with ticks either side */
const CELLS = Array.from({ length: 720 / CELL_DEG + 1 }, (_, i) => (i * CELL_DEG) % 360);
const CARDINAL: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

/** the focused route, kept current as the board changes */
export function useFocusedRoute(): RouteOption | null {
  const [route, setRoute] = useState<RouteOption | null>(null);
  useEffect(() => {
    const update = () => {
      setRoute(focusedRoute());
    };
    update();
    const offs = [
      usePlanStore.subscribe((s, p) => {
        if (s.focusRouteId !== p.focusRouteId || s.metresPerUnit !== p.metresPerUnit) update();
      }),
      useBoardStore.subscribe((s, p) => {
        if (s.view !== p.view) update();
      }),
      useSelectionStore.subscribe((s, p) => {
        if (s.hiddenLayers !== p.hiddenLayers) update();
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, []);
  return route;
}

/**
 * The compass box (exact room demo, FEATURES F24): always top-centre in a desktop room. A strip
 * of 15° ticks in the display face with an amber needle, centred on the picked route's heading
 * (start → end, 0° = north, clockwise) and sliding there when the pick changes; below it the
 * call-out line — "Plan B heads 245° SW · 1 240 m · ~4 min on foot". With nothing picked it
 * points north and says how to pick one.
 */
export function CompassBox() {
  const route = useFocusedRoute();
  const focusRoute = usePlanStore((s) => s.focusRoute);
  const bearing = route?.bearing ?? 0;
  const offset = ((360 + bearing) / CELL_DEG) * CELL_PX;
  return (
    <div
      role="status"
      aria-label="Compass"
      data-testid="compass-bar"
      data-bearing={route ? bearing : undefined}
      className="glass-panel flex w-full min-w-0 flex-col items-center gap-2 px-3 pt-2 pb-2"
    >
      <div className="relative h-[26px] w-full overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_18%,#000_82%,transparent)]">
        <div
          aria-hidden
          className="absolute top-0 left-1/2 flex motion-safe:transition-transform motion-safe:duration-[900ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateX(${-offset - CELL_PX / 2}px)` }}
        >
          {CELLS.map((deg, i) => (
            <span
              key={i}
              className={
                CARDINAL[deg]
                  ? 'shrink-0 text-center font-display text-[14px] font-bold text-text'
                  : 'shrink-0 text-center font-display text-[14px] text-text-muted'
              }
              style={{ width: CELL_PX }}
            >
              {CARDINAL[deg] ?? deg}
            </span>
          ))}
        </div>
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 -ml-px w-0.5 bg-accent shadow-[0_0_12px_var(--accent)]"
        />
      </div>
      <div className="flex max-w-full min-w-0 items-center gap-2 text-xs text-text-muted tabular-nums">
        {route ? (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: route.color }}
            />
            <span className="truncate">
              <b className="font-semibold text-text">{route.name}</b> heads{' '}
              <b className="font-semibold text-text" data-testid="compass-bearing">
                {bearing}° {compassPoint(bearing)}
              </b>{' '}
              · <b className="font-semibold text-text">{formatMetres(route.summary.total)}</b> · ~
              {route.summary.footMin} min on foot
            </span>
            <button
              type="button"
              aria-label="Clear route"
              className="-mr-1 shrink-0 rounded-[6px] p-0.5 hover:bg-white/[0.08] hover:text-text"
              onClick={() => {
                focusRoute(null);
              }}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <span className="truncate">Pick a route on the left to see its heading</span>
        )}
      </div>
    </div>
  );
}
