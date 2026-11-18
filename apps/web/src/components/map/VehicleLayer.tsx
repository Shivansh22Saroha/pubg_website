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

/** fraction of the view drawn beyond each edge, so a short pan doesn't show empty edges */
const PAD = 0.3;

/** Leaflet's own (untyped) helper the vector renderer uses for its zoom animation */
type ZoomAnimMap = L.Map & { _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point };

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
 * Vehicle spawn points on one canvas in their own pane (above the grid, below drawings).
 * Every point is a vehicle icon (car, bike, boat, glider). Zoomed out: small badges in the
 * kind's colour with a dark glyph. Zoomed in: larger dark badges with a coloured glyph. The
 * canvas covers the view plus a margin and is redrawn after every move / zoom; during a zoom
 * (animated, wheel or pinch) it stays on screen and is scaled with the map, the same way
 * Leaflet's vector renderer does, so the icons never blink out. Not interactive — it never
 * takes clicks from the tools.
 */
class SpawnCanvas extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();
  /** the view the canvas was last drawn for (the zoom transform is relative to it) */
  private drawn: { center: L.LatLng; zoom: number } | null = null;

  constructor(
    private spawns: readonly VehicleSpawn[],
    private tileWorld: number,
  ) {
    super({ pane: VEHICLE_PANE });
  }

  override onAdd(map: L.Map) {
    const animated = (map as L.Map & { _zoomAnimated?: boolean })._zoomAnimated === true;
    const c = L.DomUtil.create(
      'canvas',
      `rl-vehicle-spawns leaflet-zoom-${animated ? 'animated' : 'hide'}`,
    );
    c.style.position = 'absolute';
    c.style.pointerEvents = 'none';
    c.setAttribute('aria-hidden', 'true');
    c.dataset.testid = 'vehicle-layer';
    c.dataset.count = String(this.spawns.length);
    map.getPane(VEHICLE_PANE)?.appendChild(c);
    this.canvas = c;
    map.on('moveend resize viewreset', this.redraw);
    map.on('zoom', this.onZoom);
    if (animated) map.on('zoomanim', this.onZoomAnim);
    this.redraw();
    return this;
  }

  override onRemove(map: L.Map) {
    map.off('moveend resize viewreset', this.redraw);
    map.off('zoom', this.onZoom);
    map.off('zoomanim', this.onZoomAnim);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  private onZoomAnim = (e: L.ZoomAnimEvent) => {
    this.transform(e.center, e.zoom);
  };

  private onZoom = () => {
    const map = this._map as L.Map | undefined;
    if (map) this.transform(map.getCenter(), map.getZoom());
  };

  /** scale / shift the last drawing to where the map is heading (Leaflet Renderer maths) */
  private transform(center: L.LatLng, zoom: number) {
    const map = this._map as ZoomAnimMap | undefined;
    if (!map || !this.canvas || !this.drawn) return;
    const scale = map.getZoomScale(zoom, this.drawn.zoom);
    const offset = map
      .getSize()
      .multiplyBy(0.5 + PAD)
      .multiplyBy(-scale)
      .add(map.project(this.drawn.center, zoom))
      .subtract(map._getNewPixelOrigin(center, zoom));
    L.DomUtil.setTransform(this.canvas, offset, scale);
  }

  private sprite(kind: VehicleKind, large: boolean, dpr: number) {
    const key = `${kind}:${large ? 'L' : 'S'}:${dpr}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      sp = drawSprite(kind, large, dpr);
      this.sprites.set(key, sp);
    }
    return sp;
  }

  private redraw = () => {
    const map = this._map as L.Map | undefined;
    const c = this.canvas;
    if (!map || !c) return;
    const size = map.getSize();
    const w = Math.round(size.x * (1 + 2 * PAD));
    const h = Math.round(size.y * (1 + 2 * PAD));
    const ox = size.x * PAD;
    const oy = size.y * PAD;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    L.DomUtil.setTransform(c, map.containerPointToLayerPoint([-ox, -oy]), 1);
    this.drawn = { center: map.getCenter(), zoom: map.getZoom() };
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);

    const large = 100_000 / worldPerPx(map, this.tileWorld) >= BADGE_PX_PER_KM;
    const half = large ? 13 : 9; // sprite radius + margin, CSS px
    for (const s of this.spawns) {
      const p = map.latLngToContainerPoint(toLatLng([s.x, s.y]));
      const x = p.x + ox;
      const y = p.y + oy;
      if (x < -half || y < -half || x > w + half || y > h + half) continue;
      ctx.drawImage(
        this.sprite(s.kind, large, dpr),
        Math.round((x - half) * dpr),
        Math.round((y - half) * dpr),
      );
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
