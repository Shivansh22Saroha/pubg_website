'use client';

import { GRID_COLUMN_LETTERS, GRID_ROW_LETTERS } from '@rotationlab/shared';
import type L from 'leaflet';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { toLatLng } from '@/lib/coords';

interface Placed {
  letter: string;
  pos: number;
}
interface Layout {
  cols: Placed[];
  rows: Placed[];
  top: number;
  left: number;
}

const LABEL = 18; // px reserved for a letter
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Target view of a running zoom animation (Leaflet only updates the real view when it ends). */
type View = { center: L.LatLng; zoom: number } | null;

function compute(map: L.Map, worldSize: number, cells: number, view: View = null): Layout {
  const size = map.getSize();
  const cell = worldSize / cells;
  const toPoint = (ll: L.LatLng) =>
    view
      ? map
          .project(ll, view.zoom)
          .subtract(map.project(view.center, view.zoom))
          .add(size.divideBy(2))
      : map.latLngToContainerPoint(ll);
  const origin = toPoint(toLatLng([0, 0]));
  const cols: Placed[] = [];
  const rows: Placed[] = [];
  for (let i = 0; i < cells; i++) {
    const c = (i + 0.5) * cell;
    const p = toPoint(toLatLng([c, c]));
    if (p.x > 0 && p.x < size.x) cols.push({ letter: GRID_COLUMN_LETTERS.charAt(i), pos: p.x });
    if (p.y > 0 && p.y < size.y) rows.push({ letter: GRID_ROW_LETTERS.charAt(i), pos: p.y });
  }
  // sit just outside the map's top/left edge, but stick to the viewport edge when scrolled past
  return {
    cols,
    rows,
    top: clamp(origin.y - LABEL - 2, 4, size.y - LABEL),
    left: clamp(origin.x - LABEL - 2, 4, size.x - LABEL),
  };
}

/** Column letters along the top edge and row letters along the left edge (React text nodes). */
export function GridLabels({
  map,
  worldSize,
  cells,
}: {
  map: L.Map;
  worldSize: number;
  cells: number;
}) {
  const [layout, setLayout] = useState<Layout>(() => compute(map, worldSize, cells));
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setLayout(compute(map, worldSize, cells));
      });
    };
    // jump to the animation's target and let CSS ease along with Leaflet's 250 ms zoom
    const zoomAnim = (e: L.ZoomAnimEvent) => {
      cancelAnimationFrame(frame);
      setAnimating(true);
      setLayout(compute(map, worldSize, cells, { center: e.center, zoom: e.zoom }));
    };
    const zoomEnd = () => {
      setAnimating(false);
      update();
    };
    update();
    map.on('move zoom resize viewreset', update);
    map.on('zoomanim', zoomAnim);
    map.on('zoomend', zoomEnd);
    return () => {
      cancelAnimationFrame(frame);
      map.off('move zoom resize viewreset', update);
      map.off('zoomanim', zoomAnim);
      map.off('zoomend', zoomEnd);
    };
  }, [map, worldSize, cells]);

  const chip = cn(
    'absolute flex size-[18px] items-center justify-center rounded-[4px] bg-overlay font-display text-xs font-bold text-text',
    animating && 'transition-[left,top] duration-250 ease-[cubic-bezier(0,0,0.25,1)]',
  );
  return (
    <div
      data-testid="grid-labels"
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10"
    >
      {layout.cols.map(({ letter, pos }) => (
        <span key={letter} className={chip} style={{ left: pos - LABEL / 2, top: layout.top }}>
          {letter}
        </span>
      ))}
      {layout.rows.map(({ letter, pos }) => (
        <span key={letter} className={chip} style={{ top: pos - LABEL / 2, left: layout.left }}>
          {letter}
        </span>
      ))}
    </div>
  );
}
