import type * as Leaflet from 'leaflet';
import type { ViewElement } from '@/stores/boardModel';
import { safeColor } from './markerDom';

/** SVG pane just above the elements canvas: entrance ghosts live here for under a second */
export const FX_PANE = 'elements-fx';

const DRAW_MS = 650;
const ZONE_MS = 750;
const FADE_MS = 450;

type PathLayer = Leaflet.Path & { options: Leaflet.PathOptions };

function paths(L: typeof Leaflet, layer: Leaflet.Layer): PathLayer[] {
  if (layer instanceof L.FeatureGroup) {
    const out: PathLayer[] = [];
    layer.eachLayer((l) => out.push(l as PathLayer));
    return out;
  }
  return [layer as PathLayer];
}

/**
 * Motion library, for vectors someone else just added (the canvas can't animate, so a short
 * SVG "ghost" plays over a hidden copy, then the real element comes back):
 * - lines, strokes and arrows trace themselves in along their path (rotation draw-on);
 * - circles close in from 1.35× like a shrinking zone;
 * - polygons fade in.
 * Callers skip this under prefers-reduced-motion. Returns a cancel for unmounts.
 */
export function playEntrance(
  L: typeof Leaflet,
  map: Leaflet.Map,
  svg: Leaflet.Renderer,
  el: ViewElement,
  layer: Leaflet.Layer,
): () => void {
  const parts = paths(L, layer);
  const saved = parts.map((p) => ({ p, opacity: p.options.opacity, fill: p.options.fillOpacity }));
  for (const { p } of saved) p.setStyle({ opacity: 0, fillOpacity: 0 });

  const color = safeColor(el.style.color);
  const base: Leaflet.PathOptions = {
    renderer: svg,
    color,
    weight: el.style.width,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
  };
  let ghost: Leaflet.Path;
  let keyframes: Keyframe[];
  let duration: number;
  const first = parts[0];
  if (el.type === 'CIRCLE' && first instanceof L.Circle) {
    ghost = L.circle(first.getLatLng(), {
      ...base,
      radius: first.getRadius(),
      fill: true,
      fillColor: color,
      fillOpacity: el.style.fillOpacity,
      dashArray: el.style.dashed ? `${el.style.width * 2} ${el.style.width * 2}` : undefined,
    });
    keyframes = [
      { transform: 'scale(1.35)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ];
    duration = ZONE_MS;
  } else if (el.type === 'POLYGON' && first instanceof L.Polygon) {
    ghost = L.polygon(first.getLatLngs(), {
      ...base,
      fill: true,
      fillColor: color,
      fillOpacity: el.style.fillOpacity,
    });
    keyframes = [{ opacity: 0 }, { opacity: 1 }];
    duration = FADE_MS;
  } else if (first instanceof L.Polyline) {
    ghost = L.polyline(first.getLatLngs() as Leaflet.LatLngExpression[], base);
    keyframes = [];
    duration = DRAW_MS;
  } else {
    for (const s of saved) s.p.setStyle({ opacity: s.opacity ?? 1, fillOpacity: s.fill ?? 0 });
    return () => undefined;
  }

  ghost.addTo(map);
  const node = ghost.getElement() as SVGPathElement | undefined;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ghost.remove();
    for (const s of saved) s.p.setStyle({ opacity: s.opacity ?? 1, fillOpacity: s.fill ?? 0 });
  };
  if (!node || typeof node.animate !== 'function') {
    finish();
    return finish;
  }
  if (keyframes.length === 0) {
    const len = node.getTotalLength();
    node.style.strokeDasharray = `${len}`;
    keyframes = [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }];
  } else {
    node.style.transformBox = 'fill-box';
    node.style.transformOrigin = 'center';
  }
  const anim = node.animate(keyframes, {
    duration,
    easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    fill: 'both',
  });
  anim.onfinish = finish;
  anim.oncancel = finish;
  return finish;
}
