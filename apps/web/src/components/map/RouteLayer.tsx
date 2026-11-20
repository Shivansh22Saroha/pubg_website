'use client';

import { formatMetres } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { MEASURE_PANE } from '@/components/tools/MeasureLayer';
import { safeColor } from '@/components/map/markerDom';
import { toLatLng } from '@/lib/coords';
import { routesOf, type RouteOption } from '@/lib/plans';
import { useBoardStore } from '@/stores/boardStore';
import { usePlanStore } from '@/stores/planStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useMetresPerUnit } from './boardMapContext';

export const ROUTE_PANE = 'route-focus';

/** the focused route with the board's current data, or null (gone, hidden, or none picked) */
export function focusedRoute(): RouteOption | null {
  const { focusRouteId, metresPerUnit } = usePlanStore.getState();
  if (!focusRouteId) return null;
  const { view } = useBoardStore.getState();
  if (!(focusRouteId in view.elements)) return null;
  return (
    routesOf(
      view.elements,
      view.layers,
      metresPerUnit,
      useSelectionStore.getState().hiddenLayers,
    ).find((r) => r.id === focusRouteId) ?? null
  );
}

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

    const render = () => {
      group.clearLayers();
      const route = focusedRoute();
      if (!route) return;
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
          icon: tag(`${route.name} · ${formatMetres(route.summary.total)}`, 'rl-measure-total'),
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
