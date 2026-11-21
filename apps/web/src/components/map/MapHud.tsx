'use client';

import { formatMetres, gridRef, type Pt } from '@rotationlab/shared';
import L from 'leaflet';
import { Grid3x3, Maximize2, Minus, Plus } from 'lucide-react';
import { MapLabelsIcon } from '@/components/tools/icons';
import { Hint } from '@/components/ui/hint';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fromLatLng } from '@/lib/coords';
import { cn } from '@/lib/utils';
import { useMetresPerUnit } from './boardMapContext';
import { MANUAL_VIEW_EVENT } from './FollowController';

interface MapHudProps {
  map: L.Map;
  worldSize: number;
  labels: boolean;
  grid: boolean;
  /** absent on custom maps (no labels variant, F20) */
  onToggleLabels?: () => void;
  onToggleGrid: () => void;
  onFit: () => void;
  /** the Vehicles toggle + filter and the Recalls toggle (MapCanvas owns their state) */
  vehicles?: ReactNode;
}

function HudButton({
  label,
  shortcut,
  hint,
  pressed,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  hint?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Hint label={label} shortcut={shortcut} description={hint} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          'flex size-8 items-center justify-center rounded-control text-text transition-colors duration-150 ease-hud hover:bg-surface-2',
          pressed === true &&
            'bg-[linear-gradient(180deg,var(--accent-hi),var(--accent))] text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] hover:brightness-105',
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

/** Bottom HUD (UI_UX_SPEC §3.5): cursor grid ref + metres on the left, map controls on the right. */
export function MapHud({
  map,
  worldSize,
  labels,
  grid,
  onToggleLabels,
  onToggleGrid,
  onFit,
  vehicles,
}: MapHudProps) {
  const [cursor, setCursor] = useState<Pt | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const move = (e: L.LeafletMouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setCursor(fromLatLng(e.latlng));
      });
    };
    const out = () => {
      cancelAnimationFrame(frame);
      setCursor(null);
    };
    map.on('mousemove', move);
    map.on('mouseout', out);
    return () => {
      cancelAnimationFrame(frame);
      map.off('mousemove', move);
      map.off('mouseout', out);
    };
  }, [map]);

  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  const mpu = useMetresPerUnit();
  const ref = cursor ? gridRef(cursor, worldSize) : null;
  const readout =
    cursor && ref
      ? `${ref.label} · ${formatMetres(cursor[0] * mpu)}, ${formatMetres(cursor[1] * mpu)}`
      : '—';

  const panel = 'pointer-events-auto glass rounded-panel';
  return (
    <div
      data-testid="map-hud"
      className="pointer-events-none absolute right-[var(--chrome-right,0px)] bottom-[var(--chrome-bottom,0px)] left-[var(--chrome-left,0px)] z-20 flex items-end justify-between gap-2 p-3 transition-[right] duration-300"
    >
      <output
        data-testid="hud-readout"
        aria-label="Cursor position"
        className={cn(
          panel,
          'px-3 py-1.5 font-mono text-xs font-medium whitespace-nowrap text-text',
        )}
      >
        {readout}
      </output>
      {/* exact room demo: the zoom stack stands vertical at the bottom right, the map toggles
          under it */}
      <div ref={controlsRef} className="flex flex-col items-end gap-2">
        <div
          role="group"
          aria-label="Zoom"
          className={cn(panel, 'flex flex-col items-center gap-0.5 p-1')}
        >
          <HudButton
            label="Zoom in"
            shortcut="+"
            onClick={() => {
              window.dispatchEvent(new Event(MANUAL_VIEW_EVENT));
              map.zoomIn();
            }}
          >
            <Plus className="size-[18px]" />
          </HudButton>
          <HudButton
            label="Zoom out"
            shortcut="−"
            onClick={() => {
              window.dispatchEvent(new Event(MANUAL_VIEW_EVENT));
              map.zoomOut();
            }}
          >
            <Minus className="size-[18px]" />
          </HudButton>
          <HudButton
            label="Fit map"
            hint="Show the whole map"
            onClick={() => {
              window.dispatchEvent(new Event(MANUAL_VIEW_EVENT));
              onFit();
            }}
          >
            <Maximize2 className="size-[18px]" />
          </HudButton>
        </div>
        <div className={cn(panel, 'flex items-center gap-0.5 p-1')}>
          {onToggleLabels && (
            <HudButton
              label="Map labels"
              shortcut="N"
              hint="Show or hide place names"
              pressed={labels}
              onClick={onToggleLabels}
            >
              <MapLabelsIcon className="size-[18px]" />
            </HudButton>
          )}
          <HudButton
            label="Grid"
            shortcut="Shift+G"
            hint="Show or hide the A–H / I–P grid"
            pressed={grid}
            onClick={onToggleGrid}
          >
            <Grid3x3 className="size-[18px]" />
          </HudButton>
          {vehicles}
        </div>
      </div>
    </div>
  );
}
