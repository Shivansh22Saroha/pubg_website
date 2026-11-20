import L from 'leaflet';
import { toLatLng, worldPerPx } from '@/lib/coords';

/** at least this many screen px per km before icons switch to their large form */
export const BADGE_PX_PER_KM = 260;

/** fraction of the view drawn beyond each edge, so a short pan doesn't show empty edges */
const PAD = 0.3;

/** Leaflet's own (untyped) helper the vector renderer uses for its zoom animation */
type ZoomAnimMap = L.Map & { _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point };

export interface CanvasPoint {
  x: number;
  y: number;
  /** which sprite to stamp (a vehicle kind, …) */
  key: string;
}

export interface PointCanvasOptions {
  pane: string;
  className: string;
  testId: string;
  /** draws one sprite, `(half * 2)` CSS px square, at the given pixel ratio */
  sprite: (key: string, large: boolean, dpr: number) => HTMLCanvasElement;
  /** sprite half-size in CSS px (radius + margin) */
  half: (large: boolean) => number;
}

/**
 * Fixed map points (vehicle spawns, recall towers) on one canvas in their own pane: each sprite
 * is drawn once per key / size / pixel ratio and then stamped with `drawImage` — far cheaper
 * than hundreds of vector paths or DOM markers. The canvas covers the view plus a margin and is
 * redrawn after every move / zoom; during a zoom (animated, wheel or pinch) it stays on screen
 * and is scaled with the map, the same way Leaflet's vector renderer does, so the icons never
 * blink out. Not interactive — it never takes clicks from the tools.
 */
export class PointCanvas extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();
  /** the view the canvas was last drawn for (the zoom transform is relative to it) */
  private drawn: { center: L.LatLng; zoom: number } | null = null;

  constructor(
    private points: readonly CanvasPoint[],
    private tileWorld: number,
    private opts: PointCanvasOptions,
  ) {
    super({ pane: opts.pane });
  }

  override onAdd(map: L.Map) {
    const animated = (map as L.Map & { _zoomAnimated?: boolean })._zoomAnimated === true;
    const c = L.DomUtil.create(
      'canvas',
      `${this.opts.className} leaflet-zoom-${animated ? 'animated' : 'hide'}`,
    );
    c.style.position = 'absolute';
    c.style.pointerEvents = 'none';
    c.setAttribute('aria-hidden', 'true');
    c.dataset.testid = this.opts.testId;
    c.dataset.count = String(this.points.length);
    map.getPane(this.opts.pane)?.appendChild(c);
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

  private sprite(key: string, large: boolean, dpr: number) {
    const id = `${key}:${large ? 'L' : 'S'}:${dpr}`;
    let sp = this.sprites.get(id);
    if (!sp) {
      sp = this.opts.sprite(key, large, dpr);
      this.sprites.set(id, sp);
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
    const half = this.opts.half(large);
    for (const s of this.points) {
      const p = map.latLngToContainerPoint(toLatLng([s.x, s.y]));
      const x = p.x + ox;
      const y = p.y + oy;
      if (x < -half || y < -half || x > w + half || y > h + half) continue;
      ctx.drawImage(
        this.sprite(s.key, large, dpr),
        Math.round((x - half) * dpr),
        Math.round((y - half) * dpr),
      );
    }
  };
}
