'use client';

import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { safeColor } from '@/components/map/markerDom';
import { toLatLng } from '@/lib/coords';
import { useDraftStore } from '@/stores/toolStore';

export const DRAFT_PANE = 'drafts';

/** The local draft: dashed preview above elements, plus the circle's radius label (mono). */
export function DraftLayer() {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(DRAFT_PANE)) map.createPane(DRAFT_PANE).style.zIndex = '450';
    const renderer = L.svg({ pane: DRAFT_PANE });
    let shape: L.Layer | null = null;
    let label: L.Marker | null = null;

    const render = () => {
      shape?.remove();
      label?.remove();
      shape = null;
      label = null;
      const { draft } = useDraftStore.getState();
      if (!draft) return;
      const color = safeColor(draft.style.color);
      const base: L.PathOptions = {
        renderer,
        pane: DRAFT_PANE,
        color,
        weight: draft.style.width,
        dashArray: '6 6',
        interactive: false,
      };
      if (draft.kind === 'circle') {
        shape = L.circle(toLatLng(draft.center), {
          ...base,
          radius: draft.r,
          fillColor: color,
          fillOpacity: draft.style.fillOpacity,
        }).addTo(map);
        const el = document.createElement('span');
        el.className = 'rl-radius-label';
        el.textContent = draft.label; // never HTML (CLAUDE.md rule 5)
        label = L.marker(toLatLng([draft.center[0] + draft.r, draft.center[1]]), {
          icon: L.divIcon({ html: el, className: 'rl-radius-icon', iconSize: undefined }),
          interactive: false,
          keyboard: false,
          pane: DRAFT_PANE,
        }).addTo(map);
        return;
      }
      const latlngs = draft.points.map(toLatLng);
      shape = draft.closed
        ? L.polygon(latlngs, {
            ...base,
            fillColor: color,
            fillOpacity: draft.style.fillOpacity,
          }).addTo(map)
        : L.polyline(latlngs, base).addTo(map);
    };

    render();
    const off = useDraftStore.subscribe(render);
    return () => {
      off();
      shape?.remove();
      label?.remove();
      renderer.remove();
    };
  }, [map]);

  return null;
}
