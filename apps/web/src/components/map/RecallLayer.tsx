'use client';

import type { RecallTower } from '@rotationlab/shared';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { PointCanvas } from './pointCanvas';

export const RECALL_PANE = 'recalls';

/** the in-game recall green */
export const RECALL_GREEN = '#2EDB5B';
const GREEN_LIGHT = '#7DF59A';
const GREEN_DARK = '#0F9E3A';

/** a rounded heart in a 24-unit box */
export const RECALL_HEART =
  'M12 21c-.35 0-.7-.12-.97-.35C6.9 17.2 2.5 13.9 2.5 9.2 2.5 6.1 4.85 3.75 7.85 3.75c1.75 0 3.2.85 4.15 2.15.95-1.3 2.4-2.15 4.15-2.15 3 0 5.35 2.35 5.35 5.45 0 4.7-4.4 8-8.53 11.45-.27.23-.62.35-.97.35z';

/** sprite sizes (CSS px): the heart's width, small (zoomed out) and large (zoomed in) */
const SIZE = { small: 18, large: 28 };
const half = (large: boolean) => (large ? SIZE.large : SIZE.small) / 2 + 3;

/** a green heart with a white rim and a dark halo, so it reads on any terrain */
function drawHeart(large: boolean, dpr: number): HTMLCanvasElement {
  const h = half(large);
  const c = document.createElement('canvas');
  c.width = Math.ceil(h * 2 * dpr);
  c.height = Math.ceil(h * 2 * dpr);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const s = (large ? SIZE.large : SIZE.small) / 24;
  ctx.scale(dpr, dpr);
  ctx.translate(h - 12 * s, h - 12 * s + 0.5);
  ctx.scale(s, s);
  const path = new Path2D(RECALL_HEART);
  ctx.lineJoin = 'round';
  // dark halo
  ctx.lineWidth = 5.5;
  ctx.strokeStyle = 'rgba(4,8,6,0.7)';
  ctx.stroke(path);
  // green body, lighter at the top
  const g = ctx.createLinearGradient(0, 3, 0, 21);
  g.addColorStop(0, GREEN_LIGHT);
  g.addColorStop(0.45, RECALL_GREEN);
  g.addColorStop(1, GREEN_DARK);
  ctx.fillStyle = g;
  ctx.fill(path);
  // white rim
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke(path);
  // glossy highlight on the left lobe
  ctx.beginPath();
  ctx.ellipse(7.6, 8.4, 2.1, 1.3, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  return c;
}

/** Recall towers as green hearts (see PointCanvas), above vehicle spawns, below drawings. */
export function RecallLayer({
  towers,
  tileWorld,
}: {
  towers: readonly RecallTower[];
  tileWorld: number;
}) {
  const map = useMap();
  useEffect(() => {
    const layer = new PointCanvas(
      towers.map((t) => ({ x: t.x, y: t.y, key: 'recall' })),
      tileWorld,
      {
        pane: RECALL_PANE,
        className: 'rl-recalls',
        testId: 'recall-layer',
        sprite: (_key, large, dpr) => drawHeart(large, dpr),
        half,
      },
    ).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, towers, tileWorld]);
  return null;
}
