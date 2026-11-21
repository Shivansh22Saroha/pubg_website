'use client';

import { formatMetres, type MarkerKind, type Member } from '@rotationlab/shared';
import { Pause, Play, Route as RouteIcon, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import CountUp from '@/components/fx/CountUp/CountUp';
import SpotlightCard from '@/components/fx/SpotlightCard/SpotlightCard';
import { MARKER_LABELS } from '@/components/tools/Toolbar';
import {
  byCreation,
  compassPoint,
  createdAtOf,
  describeElement,
  formatOffset,
  replayPace,
  routesOf,
} from '@/lib/plans';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/boardStore';
import { usePlanStore } from '@/stores/planStore';
import { useSelectionStore } from '@/stores/selectionStore';

/** SpotlightCard's own dark surface swapped for the room's glass */
const ROUTE_CARD_SKIN = {
  '--spotlight-card-surface': 'rgba(255,255,255,0.035)',
  '--spotlight-card-border': 'var(--edge)',
  '--spotlight-card-shadow': 'none',
} as CSSProperties;
const TYPE_LABEL = { LINE: 'Line', ARROW: 'Arrow', STROKE: 'Pen path' } as const;
/** replay list: how many finished steps stay listed above the current one */
const LIST_BEHIND = 60;
const LIST_AHEAD = 12;

/**
 * Plan tab (FEATURES F24): the board's route options and a replay of how the plan was drawn.
 * Both only change what this tab shows — nothing is saved or sent.
 */
export function PlanPanel({ members, meId }: { members: Member[]; meId: string }) {
  return (
    <div className="flex flex-col gap-5 p-3">
      <Routes members={members} meId={meId} />
      <Replay members={members} meId={meId} />
    </div>
  );
}

function useNames(members: Member[], meId: string) {
  return useMemo(() => {
    const m = new Map(members.map((x) => [x.user.id, x.user.displayName]));
    return (id: string | null) =>
      id === meId ? 'You' : id ? (m.get(id) ?? 'A former member') : 'Someone';
  }, [members, meId]);
}

/** Route options (F24): the left panel on desktop, the Plan tab in touch sheets. */
export function Routes({ members, meId }: { members: Member[]; meId: string }) {
  const elements = useBoardStore((s) => s.view.elements);
  const layers = useBoardStore((s) => s.view.layers);
  const hidden = useSelectionStore((s) => s.hiddenLayers);
  const mpu = usePlanStore((s) => s.metresPerUnit);
  const focusId = usePlanStore((s) => s.focusRouteId);
  const focusRoute = usePlanStore((s) => s.focusRoute);
  const nameOf = useNames(members, meId);
  const routes = useMemo(
    () => routesOf(elements, layers, mpu, hidden),
    [elements, layers, mpu, hidden],
  );
  // a focused route that was deleted / hidden lets go
  useEffect(() => {
    if (focusId && !routes.some((r) => r.id === focusId)) focusRoute(null);
  }, [focusId, routes, focusRoute]);

  return (
    <section aria-labelledby="plan-routes" className="flex flex-col gap-2">
      <h2 id="plan-routes" className="flex items-baseline justify-between text-sm font-semibold">
        Route options
        {routes.length > 0 && (
          <span className="text-xs font-normal text-text-muted">{routes.length}</span>
        )}
      </h2>
      {routes.length === 0 ? (
        <p className="rounded-control border border-dashed border-white/15 p-3 text-xs text-text-muted">
          <RouteIcon className="mb-1 size-4" aria-hidden />
          Draw a line, arrow or pen path for each way to the zone. They show up here as Plan A, B, C
          with their length, travel time and heading, so the squad can compare them.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Route options" data-testid="route-list">
          {routes.map((r) => {
            const on = r.id === focusId;
            return (
              <li key={r.id}>
                <SpotlightCard
                  spotlightColor="rgba(245,185,66,0.22)"
                  style={ROUTE_CARD_SKIN}
                  className={cn(
                    'rl-route-card !rounded-[14px] !p-0 transition-shadow',
                    on &&
                      'shadow-[inset_0_0_0_1px_var(--color-accent),0_0_24px_-8px_var(--color-accent)]',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={on}
                    data-testid="route-option"
                    onClick={() => {
                      focusRoute(on ? null : r.id, !on);
                    }}
                    className="relative z-[2] flex w-full flex-col gap-1.5 p-3 text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className={cn(
                          'grid size-[26px] shrink-0 place-items-center rounded-[8px] font-display text-sm font-bold transition-colors',
                          on ? 'bg-accent text-accent-fg' : 'bg-white/[0.07] text-text',
                        )}
                        style={on ? undefined : { boxShadow: `inset 0 0 0 1.5px ${r.color}` }}
                      >
                        {r.name.slice(-1)}
                      </span>
                      <b className="min-w-0 truncate text-sm">{r.name}</b>
                      <span className="ml-auto font-display text-[20px] leading-none font-bold tabular-nums">
                        <span className="sr-only">{formatMetres(r.summary.total)}</span>
                        <span aria-hidden>
                          <CountUp to={Math.round(r.summary.total)} separator=" " duration={0.9} />
                          <span className="ml-0.5 text-xs font-semibold text-text-muted">m</span>
                        </span>
                      </span>
                    </span>
                    <span className="text-xs text-text-muted">
                      ~{r.summary.footMin} min on foot · ~{r.summary.vehicleMin} min by vehicle ·
                      heads {r.bearing}° {compassPoint(r.bearing)}
                    </span>
                    <span className="truncate text-[11px] text-text-muted">
                      {TYPE_LABEL[r.type]}
                      {r.layerName ? ` on ${r.layerName}` : ''} · {nameOf(r.createdBy)}
                    </span>
                  </button>
                </SpotlightCard>
              </li>
            );
          })}
        </ul>
      )}
      {routes.length > 0 && (
        <p className="text-[11px] text-text-muted">
          Times are approximate. Pick a route to fade the rest and see its heading.
        </p>
      )}
    </section>
  );
}

/** the board's elements in the order they were made; re-sorted only when the set changes */
function useReplayOrder() {
  const elements = useBoardStore((s) => s.view.elements);
  return useMemo(() => Object.values(elements).sort(byCreation), [elements]);
}

/** Plan replay (F24): the right panel's Replay tab on desktop, the Plan tab in touch sheets. */
export function Replay({ members, meId }: { members: Member[]; meId: string }) {
  const order = useReplayOrder();
  const step = usePlanStore((s) => s.replayStep);
  const playing = usePlanStore((s) => s.playing);
  const setStep = usePlanStore((s) => s.setReplayStep);
  const setPlaying = usePlanStore((s) => s.setPlaying);
  const nameOf = useNames(members, meId);
  const total = order.length;
  const shown = step ?? total;

  // playback: reveal elements on a timer; the end leaves replay (everything shows again)
  useEffect(() => {
    if (!playing || step === null) return;
    if (step >= total) {
      setStep(null);
      return;
    }
    const { intervalMs, perTick } = replayPace(total);
    const id = window.setTimeout(
      () => {
        setStep(Math.min(total, step + perTick));
      },
      prefersReducedMotion() ? Math.max(intervalMs, 300) : intervalMs,
    );
    return () => {
      window.clearTimeout(id);
    };
  }, [playing, step, total, setStep]);

  // leaving the room / board ends a replay (RouteLayer resets the store on a new map too)
  const setStepRef = useRef(setStep);
  useEffect(() => {
    setStepRef.current = setStep;
  });
  useEffect(
    () => () => {
      setStepRef.current(null);
    },
    [],
  );

  const t0 = order[0] ? createdAtOf(order[0].id) : null;
  const from = Math.max(0, shown - LIST_BEHIND);
  const to = Math.min(total, shown + LIST_AHEAD);

  return (
    <section aria-labelledby="plan-replay" className="flex flex-col gap-2">
      <h2 id="plan-replay" className="flex items-baseline justify-between text-sm font-semibold">
        Plan replay
        <span className="text-xs font-normal text-text-muted" data-testid="replay-count">
          {shown}/{total}
        </span>
      </h2>
      {total === 0 ? (
        <p className="text-xs text-text-muted">
          Nothing drawn on this board yet. Replay plays the drawings back in the order your squad
          made them.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="replay-play"
              aria-label={playing ? 'Pause replay' : 'Play the plan from the start'}
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                  return;
                }
                if (step === null || step >= total) setStep(0);
                setPlaying(true);
              }}
              className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_0_20px_-2px_rgba(245,185,66,0.6)] transition-transform hover:scale-105 hover:brightness-110 active:scale-95 pointer-coarse:size-11"
            >
              {playing ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4 translate-x-px" aria-hidden />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={total}
              value={shown}
              aria-label="Replay position"
              aria-valuetext={`${shown} of ${total} drawings`}
              data-testid="replay-scrub"
              className="rl-scrub h-9 min-w-0 flex-1 accent-[var(--color-accent)]"
              onChange={(e) => {
                const v = Number(e.target.value);
                setPlaying(false);
                setStep(v >= total ? null : v);
              }}
            />
            {step !== null && (
              <button
                type="button"
                aria-label="Exit replay"
                data-testid="replay-exit"
                onClick={() => {
                  setStep(null);
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {step !== null && (
            <p
              className="flex items-center gap-1.5 text-[11px] text-accent"
              data-testid="replay-banner"
            >
              <RotateCcw className="size-3" aria-hidden />
              Replaying: the map shows the first {shown} of {total}. Drawing still works.
            </p>
          )}
          <ol className="flex flex-col text-xs" aria-label="Plan history">
            {from > 0 && <li className="py-0.5 text-text-muted">… {from} earlier</li>}
            {order.slice(from, to).map((el, j) => {
              const i = from + j;
              const at = createdAtOf(el.id);
              const kind =
                el.type === 'MARKER' && typeof el.props.kind === 'string'
                  ? MARKER_LABELS[el.props.kind as MarkerKind]
                  : undefined;
              return (
                <li
                  key={el.id}
                  className={cn(
                    'flex gap-2 border-l-2 py-0.5 pl-2',
                    i < shown
                      ? 'border-accent text-text'
                      : 'border-white/10 text-text-muted opacity-40',
                    i === shown - 1 && step !== null && 'font-semibold',
                  )}
                >
                  <time className="w-11 shrink-0 font-mono tabular-nums text-text-muted">
                    {at !== null && t0 !== null ? formatOffset(at - t0) : '—'}
                  </time>
                  <span className="min-w-0">
                    <b>{nameOf(el.createdBy)}</b> {describeElement(el, kind)}
                  </span>
                </li>
              );
            })}
            {to < total && <li className="py-0.5 text-text-muted">… {total - to} more</li>}
          </ol>
        </>
      )}
    </section>
  );
}
