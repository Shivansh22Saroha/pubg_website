'use client';

import { formatMeasure, formatMetres, measure, type Pt } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toLatLng } from '@/lib/coords';
import { useMeasureStore } from '@/stores/measureStore';

export const MEASURE_PANE = 'measure';

function label(text: string, className: string): L.DivIcon {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text; // never HTML
  return L.divIcon({ html: el, className: 'rl-measure-icon', iconSize: undefined });
}

/**
 * The measure line (FEATURES F11): a neutral white dashed line with a dark halo above every
 * layer, each segment's length at its midpoint, and the total + approx. travel times at the end.
 * Local only — nothing is sent.
 */
export function MeasureLayer() {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(MEASURE_PANE)) map.createPane(MEASURE_PANE).style.zIndex = '655';
    const renderer = L.svg({ pane: MEASURE_PANE, padding: 0.5 });
    const group = L.layerGroup().addTo(map);

    const render = () => {
      group.clearLayers();
      const line = useMeasureStore.getState().line;
      if (!line || line.points.length === 0) return;
      const pts: Pt[] = line.hover ? [...line.points, line.hover] : line.points;
      const latlngs = pts.map(toLatLng);
      const base = { renderer, pane: MEASURE_PANE, interactive: false } as const;
      L.polyline(latlngs, { ...base, color: '#0B0F14', weight: 5, opacity: 0.7 }).addTo(group);
      L.polyline(latlngs, {
        ...base,
        color: '#F8FAFC',
        weight: 2,
        dashArray: '6 4',
        className: 'rl-measure-line',
      }).addTo(group);
      for (const p of line.points)
        L.circleMarker(toLatLng(p), {
          ...base,
          radius: 3.5,
          color: '#0B0F14',
          weight: 1.5,
          fillColor: '#F8FAFC',
          fillOpacity: 1,
        }).addTo(group);

      const summary = measure(pts);
      summary.segments.forEach((m, i) => {
        const a = pts[i];
        const b = pts[i + 1];
        if (!a || !b || summary.segments.length < 2) return;
        L.marker(toLatLng([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), {
          icon: label(formatMetres(m), 'rl-measure-segment'),
          interactive: false,
          keyboard: false,
          pane: MEASURE_PANE,
        }).addTo(group);
      });
      const end = pts.at(-1);
      if (end && summary.total > 0) {
        L.marker(toLatLng(end), {
          icon: label(formatMeasure(summary), 'rl-measure-total'),
          interactive: false,
          keyboard: false,
          pane: MEASURE_PANE,
        }).addTo(group);
      }
    };

    render();
    const off = useMeasureStore.subscribe(render);
    return () => {
      off();
      group.remove();
      renderer.remove();
      useMeasureStore.setState({ line: null });
    };
  }, [map]);

  return null;
}
