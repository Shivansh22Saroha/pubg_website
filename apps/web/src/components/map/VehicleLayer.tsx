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
  car: 'M4.5 15.5V12l1.8-4.2a1 1 0 0 1 .9-.6h9.6a1 1 0 0 1 .9.6l1.8 4.2v3.5ZM4.5 12h15M7.5 15.5v2M16.5 15.5v2',
  bike: 'M3 16.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 16.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 16.5l3.5-6h5l3.5 6M9.5 10.5 8.5 7.5H6.5M14.5 10.5l1-3h2',
  boat: 'M3 14h18l-3 4.5H6ZM12 14V4.5l6.5 7.5H12',
  glider: 'M2 11h20M12 6.5v9.5M9 16h6M10.5 6.5h3',
};

/** at least this many screen px per km before points become icon badges (else dots) */
const BADGE_PX_PER_KM = 260;

/**
 * Vehicle spawn points on one canvas in their own pane (above the grid, below drawings).
 * Zoomed out: small coloured dots. Zoomed in: dark round badges with the vehicle glyph. The
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
    const badges = pxPerKm >= BADGE_PX_PER_KM;
    const r = badges ? 11 : 3;
    for (const s of this.spawns) {
      const p = map.latLngToContainerPoint(toLatLng([s.x, s.y]));
      const x = p.x + ox;
      const y = p.y + oy;
      if (x < -r || y < -r || x > w + r || y > h + r) continue;
      const color = VEHICLE_COLORS[s.kind];
      if (!badges) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(5,7,10,0.85)';
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,12,16,0.88)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      const glyph = this.glyphs.get(s.kind);
      if (glyph) {
        ctx.save();
        const scale = 0.62;
        ctx.translate(x - 12 * scale, y - 12 * scale);
        ctx.scale(scale, scale);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.stroke(glyph);
        ctx.restore();
      }
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
