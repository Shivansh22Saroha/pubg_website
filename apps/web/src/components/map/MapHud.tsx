'use client';

import { formatMetres, gridRef, type Pt } from '@rotationlab/shared';
import L from 'leaflet';
import { Grid3x3, Maximize2, Minus, Plus } from 'lucide-react';
import { MapLabelsIcon } from '@/components/tools/icons';
import { Hint } from '@/components/ui/hint';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fromLatLng } from '@/lib/coords';
import { cn } from '@/lib/utils';
import { MANUAL_VIEW_EVENT } from './FollowController';

interface MapHudProps {
  map: L.Map;
  worldSize: number;
  labels: boolean;
  grid: boolean;
  onToggleLabels: () => void;
  onToggleGrid: () => void;
  onFit: () => void;
  /** the Vehicles toggle + filter (MapCanvas owns its state) */
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

  const ref = cursor ? gridRef(cursor, worldSize) : null;
  const readout =
    cursor && ref
      ? `${ref.label} · ${formatMetres(cursor[0] / 100)}, ${formatMetres(cursor[1] / 100)}`
      : '—';

  const panel = 'pointer-events-auto glass rounded-panel';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 p-3">
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
      <div ref={controlsRef} className={cn(panel, 'flex items-center gap-0.5 p-1')}>
        <HudButton
          label="Map labels"
          shortcut="N"
          hint="Show or hide place names"
          pressed={labels}
          onClick={onToggleLabels}
        >
          <MapLabelsIcon className="size-[18px]" />
        </HudButton>
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
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
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
    </div>
  );
}
