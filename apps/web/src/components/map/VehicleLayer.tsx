'use client';

import type { VehicleKind, VehicleSpawn } from '@rotationlab/shared';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { PointCanvas } from './pointCanvas';

export const VEHICLE_PANE = 'vehicles';

/** per-kind colours: distinct from each other and from the drawing palette's gold default */
export const VEHICLE_COLORS: Record<VehicleKind, string> = {
  car: '#60A5FA',
  bike: '#34D399',
  boat: '#22D3EE',
  glider: '#F472B6',
};

/** 24-unit glyphs (stroked), the same shapes as the legend icons */
export const VEHICLE_GLYPHS: Record<VehicleKind, string> = {
  car: 'M5 15.5H3.5v-2.9a1 1 0 0 1 .7-1l1.3-.5 2.4-3.3a1 1 0 0 1 .8-.4h5.6a1 1 0 0 1 .8.4l2.7 3.3 2.3.6a1 1 0 0 1 .8 1v2.8H19M9 15.5h6M5 15.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 15.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5.5 11.1h12.3M11.5 7.4v3.7',
  bike: 'M3 16.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 16.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 16.5l3.5-6h5l3.5 6M9.5 10.5 8.5 7.5H6.5M14.5 10.5l1-3h2',
  boat: 'M3 14h18l-3 4.5H6ZM12 14V4.5l6.5 7.5H12',
  glider: 'M2 11h20M12 6.5v9.5M9 16h6M10.5 6.5h3',
};

/**
 * One vehicle badge, drawn once per kind / size / pixel ratio and then stamped with
 * `drawImage` — far cheaper than tracing 600+ vector paths on every redraw.
 */
function drawSprite(kind: VehicleKind, large: boolean, dpr: number): HTMLCanvasElement {
  const r = large ? 11 : 7;
  const size = (r + 2) * 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(size * dpr);
  c.height = Math.ceil(size * dpr);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.scale(dpr, dpr);
  const color = VEHICLE_COLORS[kind];
  const mid = size / 2;
  ctx.beginPath();
  ctx.arc(mid, mid, r, 0, Math.PI * 2);
  ctx.fillStyle = large ? 'rgba(10,12,16,0.88)' : color;
  ctx.fill();
  ctx.lineWidth = large ? 2 : 1;
  ctx.strokeStyle = large ? color : 'rgba(5,7,10,0.85)';
  ctx.stroke();
  const scale = large ? 0.62 : 0.42;
  ctx.translate(mid - 12 * scale, mid - 12 * scale);
  ctx.scale(scale, scale);
  ctx.lineWidth = large ? 2.2 : 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = large ? color : 'rgba(5,7,10,0.92)';
  ctx.stroke(new Path2D(VEHICLE_GLYPHS[kind]));
  return c;
}

/**
 * Vehicle spawn points (see PointCanvas). Every point is a vehicle icon (car, bike, boat,
 * glider). Zoomed out: small badges in the kind's colour with a dark glyph. Zoomed in: larger
 * dark badges with a coloured glyph.
 */
export function VehicleLayer({
  spawns,
  kinds,
  tileWorld,
}: {
  spawns: readonly VehicleSpawn[];
  kinds: readonly VehicleKind[];
  tileWorld: number;
}) {
  const map = useMap();
  useEffect(() => {
    const shown = spawns.filter((s) => kinds.includes(s.kind));
    const layer = new PointCanvas(
      shown.map((s) => ({ x: s.x, y: s.y, key: s.kind })),
      tileWorld,
      {
        pane: VEHICLE_PANE,
        className: 'rl-vehicle-spawns',
        testId: 'vehicle-layer',
        sprite: (key, large, dpr) => drawSprite(key as VehicleKind, large, dpr),
        // sprite radius + margin, CSS px
        half: (large) => (large ? 13 : 9),
      },
    ).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, spawns, kinds, tileWorld]);
  return null;
}
