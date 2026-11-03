import type { Layer as BoardLayer } from '@rotationlab/shared';
import type * as Leaflet from 'leaflet';
import type { ViewElement } from '@/stores/boardModel';
import { drawnPoints } from '@rotationlab/shared';
import { markerElement, safeColor, textElement } from './markerDom';

type Pt = [number, number];
type LatLngTuple = [number, number];

/** The parts of the Leaflet namespace the renderer uses (tests pass a fake). */
export interface LeafletApi {
  polyline: typeof Leaflet.polyline;
  polygon: typeof Leaflet.polygon;
  circle: (
    latlng: Leaflet.LatLngExpression,
    options: Leaflet.CircleMarkerOptions,
  ) => Leaflet.Circle;
  marker: typeof Leaflet.marker;
  divIcon: typeof Leaflet.divIcon;
  featureGroup: typeof Leaflet.featureGroup;
}

export interface MapLike {
  addLayer(layer: Leaflet.Layer): unknown;
  removeLayer(layer: Leaflet.Layer): unknown;
  getZoom(): number;
}

interface Entry {
  el: ViewElement;
  layer: Leaflet.Layer;
  /** vector (canvas) layers can be reordered; markers use zIndexOffset */
  vector: boolean;
  onMap: boolean;
}

export interface SyncStats {
  created: number;
  replaced: number;
  removed: number;
  reordered: boolean;
}

const ll = ([x, y]: Pt): LatLngTuple => [y, x]; // LatLng == world units: lat = y, lng = x

function dashArray(width: number, dashed: boolean): string | undefined {
  return dashed ? `${width * 2} ${width * 2}` : undefined;
}

/**
 * Renders board elements on Leaflet (UI_UX_SPEC §6) and keeps it in sync by *diffing*:
 * entries are keyed by id and compared by object identity (the store keeps unchanged elements
 * referentially equal), so only added / changed / removed elements touch Leaflet.
 *
 * Vectors share one canvas renderer; stroke `weight` is in screen pixels so widths stay
 * constant on screen. Arrowheads are sized in pixels and recomputed on zoom. Draw order is
 * layer position → z → id; hidden layers are taken off the map but kept cached.
 */
export class ElementRenderer {
  private entries = new Map<string, Entry>();
  private layerPos = new Map<string, number>();
  private layerVisible = new Map<string, boolean>();

  constructor(
    private readonly L: LeafletApi,
    private readonly map: MapLike,
    private readonly renderer: Leaflet.Renderer,
    /** world units spanned by the whole tile pyramid (CRS scale) */
    private readonly tileWorldSize: number,
  ) {}

  private worldPerPx(): number {
    return this.tileWorldSize / (256 * 2 ** this.map.getZoom());
  }

  // ---- element → Leaflet ------------------------------------------------------------------

  private arrowHead(points: Pt[], width: number): LatLngTuple[] {
    const tip = points.at(-1);
    const from = points.at(-2);
    if (!tip || !from) return [];
    const dx = tip[0] - from[0];
    const dy = tip[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const k = this.worldPerPx();
    const headLen = (8 + width * 2) * k;
    const half = headLen * 0.6;
    const bx = tip[0] - ux * headLen;
    const by = tip[1] - uy * headLen;
    return [ll(tip), ll([bx - uy * half, by + ux * half]), ll([bx + uy * half, by - ux * half])];
  }

  private create(el: ViewElement): { layer: Leaflet.Layer; vector: boolean } {
    const { L, renderer } = this;
    const color = safeColor(el.style.color);
    const width = el.style.width;
    const base: Leaflet.PathOptions = {
      renderer,
      color,
      weight: width,
      dashArray: dashArray(width, el.style.dashed),
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    };
    const g = el.geometry as { points?: Pt[]; center?: Pt; r?: number; at?: Pt };
    switch (el.type) {
      case 'STROKE':
      case 'LINE':
        return { layer: L.polyline((g.points ?? []).map(ll), base), vector: true };
      case 'ARROW': {
        // Phase 12: a curved arrow is drawn (and its heads aimed) along its sampled curve
        const pts: Pt[] = drawnPoints({ type: 'ARROW', geometry: g, props: el.props }).map(
          ([x, y]) => [x, y],
        );
        const line = L.polyline(pts.map(ll), base);
        const headStyle: Leaflet.PolylineOptions = {
          ...base,
          dashArray: undefined,
          fill: true,
          fillColor: color,
          fillOpacity: 1,
          weight: 1,
        };
        const parts: Leaflet.Layer[] = [line, L.polygon(this.arrowHead(pts, width), headStyle)];
        // Phase 11: double-headed — the same head, computed from the reversed path
        if ((el.props as { doubleHeaded?: unknown }).doubleHeaded === true)
          parts.push(L.polygon(this.arrowHead([...pts].reverse(), width), headStyle));
        return { layer: L.featureGroup(parts), vector: true };
      }
      case 'CIRCLE':
        return {
          layer: L.circle(ll(g.center ?? [0, 0]), {
            ...base,
            radius: g.r ?? 0,
            fill: true,
            fillColor: color,
            fillOpacity: el.style.fillOpacity,
          }),
          vector: true,
        };
      case 'POLYGON':
        return {
          layer: L.polygon((g.points ?? []).map(ll), {
            ...base,
            fill: true,
            fillColor: color,
            fillOpacity: el.style.fillOpacity,
          }),
          vector: true,
        };
      case 'TEXT': {
        const icon = L.divIcon({
          html: textElement(el.props, color),
          className: 'rl-text-icon',
          iconSize: undefined,
        });
        return {
          layer: L.marker(ll(g.at ?? [0, 0]), {
            icon,
            interactive: false,
            keyboard: false,
            zIndexOffset: this.zOffset(el),
          }),
          vector: false,
        };
      }
      case 'MARKER': {
        const icon = L.divIcon({
          html: markerElement(el.props, color),
          className: 'rl-marker-icon',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        return {
          layer: L.marker(ll(g.at ?? [0, 0]), {
            icon,
            interactive: false,
            keyboard: false,
            zIndexOffset: this.zOffset(el),
          }),
          vector: false,
        };
      }
    }
  }

  private zOffset(el: ViewElement): number {
    return (this.layerPos.get(el.layerId) ?? 0) * 10_000 + Math.max(-5000, Math.min(5000, el.z));
  }

  private compare = (a: ViewElement, b: ViewElement) =>
    (this.layerPos.get(a.layerId) ?? 0) - (this.layerPos.get(b.layerId) ?? 0) ||
    a.z - b.z ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // ---- sync -------------------------------------------------------------------------------

  /** Diff the store view against what's on the map. */
  sync(elements: Readonly<Record<string, ViewElement>>, layers: readonly BoardLayer[]): SyncStats {
    const stats: SyncStats = { created: 0, replaced: 0, removed: 0, reordered: false };
    let layersChanged = false;
    for (const l of layers) {
      if (this.layerPos.get(l.id) !== l.position || this.layerVisible.get(l.id) !== l.visible)
        layersChanged = true;
    }
    if (layers.length !== this.layerPos.size) layersChanged = true;
    this.layerPos = new Map(layers.map((l) => [l.id, l.position]));
    this.layerVisible = new Map(layers.map((l) => [l.id, l.visible]));

    for (const [id, entry] of this.entries) {
      if (!(id in elements)) {
        if (entry.onMap) this.map.removeLayer(entry.layer);
        this.entries.delete(id);
        stats.removed++;
      }
    }
    for (const el of Object.values(elements)) {
      const entry = this.entries.get(el.id);
      if (entry && entry.el === el && !(layersChanged && !entry.vector)) continue;
      if (entry) {
        if (entry.onMap) this.map.removeLayer(entry.layer);
        stats.replaced++;
      } else {
        stats.created++;
      }
      const made = this.create(el);
      this.entries.set(el.id, { el, ...made, onMap: false });
    }

    // visibility: layers that are hidden (or unknown) keep their elements off the map
    const added = new Set<string>();
    for (const entry of this.entries.values()) {
      const visible = this.layerVisible.get(entry.el.layerId) ?? false;
      if (visible && !entry.onMap) {
        this.map.addLayer(entry.layer);
        entry.onMap = true;
        if (entry.vector) added.add(entry.el.id);
      } else if (!visible && entry.onMap) {
        this.map.removeLayer(entry.layer);
        entry.onMap = false;
      }
    }

    // Draw order for canvas vectors. Newly added paths land on top of the canvas; that's
    // correct when they all sort after every untouched path (the common case: new drawings),
    // so only they get re-stacked. Anything else — a moved element that belongs lower down,
    // a layer reorder — re-stacks everything once.
    const sorted = [...this.entries.values()]
      .filter((e) => e.vector && e.onMap)
      .sort((a, b) => this.compare(a.el, b.el));
    const firstAdded = sorted.findIndex((e) => added.has(e.el.id));
    const tailOnly = firstAdded === -1 || sorted.slice(firstAdded).every((e) => added.has(e.el.id));
    const restack = layersChanged || !tailOnly ? sorted : sorted.slice(Math.max(0, firstAdded));
    if (added.size > 0 || layersChanged) {
      for (const e of restack) (e.layer as unknown as { bringToFront(): void }).bringToFront();
      stats.reordered = layersChanged || !tailOnly;
    }
    return stats;
  }

  /** Arrowheads are sized in screen pixels: rebuild arrows after a zoom, then restack. */
  onZoom() {
    let rebuilt = false;
    for (const [id, entry] of this.entries) {
      if (entry.el.type !== 'ARROW') continue;
      rebuilt = true;
      if (entry.onMap) this.map.removeLayer(entry.layer);
      const made = this.create(entry.el);
      const visible = this.layerVisible.get(entry.el.layerId) ?? false;
      if (visible) this.map.addLayer(made.layer);
      this.entries.set(id, { el: entry.el, ...made, onMap: visible });
    }
    if (rebuilt) {
      const sorted = [...this.entries.values()]
        .filter((e) => e.vector && e.onMap)
        .sort((a, b) => this.compare(a.el, b.el));
      for (const e of sorted) (e.layer as unknown as { bringToFront(): void }).bringToFront();
    }
  }

  destroy() {
    for (const e of this.entries.values()) if (e.onMap) this.map.removeLayer(e.layer);
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
