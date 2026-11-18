'use client';

import type { VehicleKind, VehicleSpawn } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toLatLng, worldPerPx } from '@/lib/coords';

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

/** at least this many screen px per km before icons switch to the large badges */
const BADGE_PX_PER_KM = 260;

/**
 * Vehicle spawn points on one canvas in their own pane (above the grid, below drawings).
 * Every point is a vehicle icon (car, bike, boat, glider). Zoomed out: small badges in the
 * kind's colour with a dark glyph. Zoomed in: larger dark badges with a coloured glyph. The
 * canvas covers the view plus a margin, is re-placed and redrawn after every move / zoom, and
 * hidden during zoom animations. Not interactive — it never takes clicks from the tools.
 */
class SpawnCanvas extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private glyphs = new Map<VehicleKind, Path2D>();

  constructor(
    private spawns: readonly VehicleSpawn[],
    private tileWorld: number,
  ) {
    super({ pane: VEHICLE_PANE });
  }

  override onAdd(map: L.Map) {
    const c = L.DomUtil.create('canvas', 'rl-vehicle-spawns');
    c.style.position = 'absolute';
    c.style.pointerEvents = 'none';
    c.setAttribute('aria-hidden', 'true');
    c.dataset.testid = 'vehicle-layer';
    c.dataset.count = String(this.spawns.length);
    map.getPane(VEHICLE_PANE)?.appendChild(c);
    this.canvas = c;
    for (const [k, d] of Object.entries(VEHICLE_GLYPHS))
      this.glyphs.set(k as VehicleKind, new Path2D(d));
    map.on('moveend zoomend resize viewreset', this.redraw);
    map.on('zoomstart', this.hide);
    this.redraw();
    return this;
  }

  override onRemove(map: L.Map) {
    map.off('moveend zoomend resize viewreset', this.redraw);
    map.off('zoomstart', this.hide);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  private hide = () => {
    if (this.canvas) this.canvas.style.visibility = 'hidden';
  };

  private redraw = () => {
    const map = this._map as L.Map | undefined;
    const c = this.canvas;
    if (!map || !c) return;
    const size = map.getSize();
    const pad = 0.3; // draw a margin so a short pan doesn't show empty edges
    const w = Math.round(size.x * (1 + 2 * pad));
    const h = Math.round(size.y * (1 + 2 * pad));
    const ox = size.x * pad;
    const oy = size.y * pad;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([-ox, -oy]));
    c.style.visibility = 'visible';
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pxPerKm = 100_000 / worldPerPx(map, this.tileWorld);
    const large = pxPerKm >= BADGE_PX_PER_KM;
    // zoomed out: small filled badges with a dark glyph (reads at 14 px); zoomed in: dark
    // badges with a coloured ring and glyph
    const r = large ? 11 : 7;
    const scale = large ? 0.62 : 0.42;
    for (const s of this.spawns) {
      const p = map.latLngToContainerPoint(toLatLng([s.x, s.y]));
      const x = p.x + ox;
      const y = p.y + oy;
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      const color = VEHICLE_COLORS[s.kind];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = large ? 'rgba(10,12,16,0.88)' : color;
      ctx.fill();
      ctx.lineWidth = large ? 2 : 1;
      ctx.strokeStyle = large ? color : 'rgba(5,7,10,0.85)';
      ctx.stroke();
      const glyph = this.glyphs.get(s.kind);
      if (!glyph) continue;
      ctx.save();
      ctx.translate(x - 12 * scale, y - 12 * scale);
      ctx.scale(scale, scale);
      ctx.lineWidth = large ? 2.2 : 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = large ? color : 'rgba(5,7,10,0.92)';
      ctx.stroke(glyph);
      ctx.restore();
    }
  };
}

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
    const layer = new SpawnCanvas(shown, tileWorld).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, spawns, kinds, tileWorld]);
  return null;
}
