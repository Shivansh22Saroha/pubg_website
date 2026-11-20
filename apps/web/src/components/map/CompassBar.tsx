'use client';

import { formatMetres } from '@rotationlab/shared';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { compassPoint, type RouteOption } from '@/lib/plans';
import { useBoardStore } from '@/stores/boardStore';
import { usePlanStore } from '@/stores/planStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { focusedRoute } from './RouteLayer';

const CELL_DEG = 15;
const CELL_PX = 28;
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
function useFocusedRoute(): RouteOption | null {
  const [route, setRoute] = useState<RouteOption | null>(() => focusedRoute());
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
 * In-game style compass bar (FEATURES F24) for the route picked in the Plan tab: a strip of
 * 15° ticks centred on the route's heading (start → end, 0° = north, clockwise), with the
 * bearing, distance and approx. travel time — what the IGL calls out ("Plan B, 245, 1.2 km").
 */
export function CompassBar() {
  const route = useFocusedRoute();
  const focusRoute = usePlanStore((s) => s.focusRoute);
  if (!route) return null;
  const { bearing, summary } = route;
  // the strip's first cell is 0°; centre the second turn's `bearing` under the needle
  const offset = ((360 + bearing) / CELL_DEG) * CELL_PX;
  return (
    <div
      className="pointer-events-none absolute z-[700] flex justify-center"
      style={{
        top: 'calc(var(--chrome-top, 0px) + 0.75rem)',
        left: 'calc(var(--chrome-left, 0px) + 0.75rem)',
        right: 'calc(var(--chrome-right, 0px) + 0.75rem)',
      }}
    >
      <div
        role="status"
        aria-label="Compass"
        data-testid="compass-bar"
        data-bearing={bearing}
        data-rl-overlay=""
        className="glass-panel animate-drop-in pointer-events-auto flex max-w-full flex-col items-center gap-1 px-3 pt-1.5 pb-2"
      >
        <div className="relative h-7 w-[252px] max-w-[70vw] overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_22%,#000_78%,transparent)]">
          <div
            aria-hidden
            className="absolute top-0 left-1/2 flex h-full motion-safe:transition-transform motion-safe:duration-500"
            style={{ transform: `translateX(${-offset - CELL_PX / 2}px)` }}
          >
            {CELLS.map((deg, i) => (
              <span
                key={i}
                className="flex h-full shrink-0 flex-col items-center justify-end font-mono text-[10px] leading-none text-text-muted"
                style={{ width: CELL_PX }}
              >
                {CARDINAL[deg] ? (
                  <b className="mb-0.5 font-display text-[12px] text-text">{CARDINAL[deg]}</b>
                ) : (
                  <span className="mb-0.5">{deg}</span>
                )}
                <i className={deg % 45 === 0 ? 'h-2 w-px bg-text' : 'h-1 w-px bg-text-muted'} />
              </span>
            ))}
          </div>
          <span
            aria-hidden
            className="absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 bg-accent"
          />
        </div>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: route.color }}
          />
          <span>
            <b>{route.name}</b> heads{' '}
            <b className="font-mono text-accent" data-testid="compass-bearing">
              {bearing}° {compassPoint(bearing)}
            </b>{' '}
            · {formatMetres(summary.total)} · ~{summary.footMin} min on foot
          </span>
          <button
            type="button"
            aria-label="Clear route"
            className="-mr-1 rounded-control p-0.5 text-text-muted hover:bg-surface-2 hover:text-text"
            onClick={() => {
              focusRoute(null);
            }}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
