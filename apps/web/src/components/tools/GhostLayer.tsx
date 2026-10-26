'use client';

import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { safeColor } from '@/components/map/markerDom';
import { toLatLng } from '@/lib/coords';
import { usePresenceStore } from '@/stores/presenceStore';
import { DRAFT_PANE } from './DraftLayer';

/** Other users' in-progress drawings: 50 % opacity in their presence colour; expire after 3 s. */
export function GhostLayer() {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(DRAFT_PANE)) map.createPane(DRAFT_PANE).style.zIndex = '450';
    const renderer = L.svg({ pane: DRAFT_PANE });
    const lines = new Map<string, L.Polyline>();

    const render = () => {
      const { ghosts, users } = usePresenceStore.getState();
      for (const [id, line] of lines) {
        if (!(id in ghosts)) {
          line.remove();
          lines.delete(id);
        }
      }
      for (const g of Object.values(ghosts)) {
        const latlngs = g.points.map(toLatLng);
        const existing = lines.get(g.userId);
        if (existing) {
          existing.setLatLngs(latlngs);
          continue;
        }
        lines.set(
          g.userId,
          L.polyline(latlngs, {
            renderer,
            pane: DRAFT_PANE,
            color: safeColor(users[g.userId]?.color, '#38BDF8'),
            weight: g.style.width,
            opacity: 0.5,
            dashArray: g.style.dashed ? `${g.style.width * 2} ${g.style.width * 2}` : undefined,
            interactive: false,
            className: 'rl-ghost',
          }).addTo(map),
        );
      }
    };

    render();
    const off = usePresenceStore.subscribe(render);
    const prune = setInterval(() => {
      usePresenceStore.getState().pruneGhosts();
    }, 500);
    return () => {
      off();
      clearInterval(prune);
      for (const line of lines.values()) line.remove();
      renderer.remove();
    };
  }, [map]);

  return null;
}
