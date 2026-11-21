'use client';

import { formatMetres } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { MEASURE_PANE } from '@/components/tools/MeasureLayer';
import { safeColor } from '@/components/map/markerDom';
import { toLatLng } from '@/lib/coords';
import { focusedRoute } from '@/lib/focusedRoute';
import { useBoardStore } from '@/stores/boardStore';
import { usePlanStore } from '@/stores/planStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useMetresPerUnit } from './boardMapContext';

export const ROUTE_PANE = 'route-focus';

function tag(text: string, className: string): L.DivIcon {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text; // never HTML
  return L.divIcon({ html: el, className: 'rl-measure-icon', iconSize: undefined });
}

/**
 * The route picked in the Plan tab (FEATURES F24): a soft glow under it, start and end dots and
 * its name + length at the end, above the (faded) drawings. Fits the map to it when asked. Also
 * publishes the board's metres-per-unit for the panel, which lives outside the map.
 */
export function RouteLayer() {
  const map = useMap();
  const mpu = useMetresPerUnit();

  useEffect(() => {
    usePlanStore.getState().setMetresPerUnit(mpu);
  }, [mpu]);

  // a new board / map: nothing stays focused or mid-replay
  useEffect(
    () => () => {
      usePlanStore.getState().reset();
    },
    [map],
  );

  useEffect(() => {
    if (!map.getPane(ROUTE_PANE)) map.createPane(ROUTE_PANE).style.zIndex = '398';
    const renderer = L.svg({ pane: ROUTE_PANE, padding: 0.5 });
    const group = L.layerGroup().addTo(map);
    let lastFit = usePlanStore.getState().fitRequest;
    let lastDrawn: string | null = null;

    const render = () => {
      group.clearLayers();
      const route = focusedRoute();
      if (!route) {
        lastDrawn = null;
        return;
      }
      const latlngs = route.points.map(toLatLng);
      const color = safeColor(route.color);
      const base = { renderer, pane: ROUTE_PANE, interactive: false } as const;
      L.polyline(latlngs, {
        ...base,
        color,
        weight: 16,
        opacity: 0.28,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'rl-route-glow',
      }).addTo(group);
      // exact room demo: a newly picked route draws itself over its glow (once per pick)
      const core = L.polyline(latlngs, {
        ...base,
        color,
        weight: 4,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        className: lastDrawn === route.id ? 'rl-route-core' : 'rl-route-core rl-draw-in',
      }).addTo(group);
      core.getElement()?.setAttribute('pathLength', '1');
      lastDrawn = route.id;
      const ends = [route.points[0], route.points.at(-1)];
      for (const p of ends)
        if (p)
          L.circleMarker(toLatLng(p), {
            ...base,
            radius: 5,
            color: '#0B0F14',
            weight: 2,
            fillColor: color,
            fillOpacity: 1,
          }).addTo(group);
      const end = route.points.at(-1);
      if (end)
        L.marker(toLatLng(end), {
          icon: tag(
            `${route.name} · ${formatMetres(route.summary.total)}`,
            'rl-measure-total rl-glass-tag',
          ),
          interactive: false,
          keyboard: false,
          pane: MEASURE_PANE,
        }).addTo(group);

      const { fitRequest } = usePlanStore.getState();
      if (fitRequest !== lastFit) {
        lastFit = fitRequest;
        const c = useWorkspaceStore.getState().chrome;
        map.fitBounds(L.latLngBounds(latlngs), {
          paddingTopLeft: [c.left + 48, c.top + 96],
          paddingBottomRight: [c.right + 48, c.bottom + 96],
          maxZoom: map.getMaxZoom() - 1,
        });
      }
    };

    if (!map.getPane(MEASURE_PANE)) map.createPane(MEASURE_PANE).style.zIndex = '655';
    render();
    const offPlan = usePlanStore.subscribe((s, prev) => {
      if (
        s.focusRouteId !== prev.focusRouteId ||
        s.fitRequest !== prev.fitRequest ||
        s.metresPerUnit !== prev.metresPerUnit
      )
        render();
    });
    const offBoard = useBoardStore.subscribe((s, prev) => {
      if (s.view !== prev.view && usePlanStore.getState().focusRouteId) render();
    });
    const offSel = useSelectionStore.subscribe((s, prev) => {
      if (s.hiddenLayers !== prev.hiddenLayers) render();
    });
    return () => {
      offPlan();
      offBoard();
      offSel();
      group.remove();
      renderer.remove();
    };
  }, [map]);

  return null;
}
