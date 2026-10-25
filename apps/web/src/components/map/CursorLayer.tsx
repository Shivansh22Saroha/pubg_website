'use client';

import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toLatLng } from '@/lib/coords';
import { usePresenceStore, type Cursor } from '@/stores/presenceStore';
import { cursorElement } from './markerDom';

export const CURSOR_FADE_MS = 5_000;

/**
 * Other users' cursors on this board (RT-2, UI_UX_SPEC §5): arrow + name pill in their
 * presence colour, faded after 5 s without movement. Markers are reused and only moved.
 */
export function CursorLayer({ names, meId }: { names: Record<string, string>; meId: string }) {
  const map = useMap();

  useEffect(() => {
    const markers = new Map<string, { marker: L.Marker; color: string }>();

    const render = (cursors: Record<string, Cursor>, colors: Record<string, string>) => {
      const now = Date.now();
      for (const [userId, entry] of markers) {
        if (!(userId in cursors)) {
          entry.marker.remove();
          markers.delete(userId);
        }
      }
      for (const c of Object.values(cursors)) {
        if (c.userId === meId) continue;
        const color = colors[c.userId] ?? '#38BDF8';
        let entry = markers.get(c.userId);
        if (!entry || entry.color !== color) {
          entry?.marker.remove();
          const icon = L.divIcon({
            html: cursorElement(names[c.userId] ?? 'Teammate', color),
            className: 'rl-cursor-icon',
            iconSize: undefined,
            iconAnchor: [1, 1],
          });
          entry = {
            marker: L.marker(toLatLng([c.x, c.y]), {
              icon,
              interactive: false,
              keyboard: false,
              zIndexOffset: 100_000,
            }).addTo(map),
            color,
          };
          markers.set(c.userId, entry);
        } else {
          entry.marker.setLatLng(toLatLng([c.x, c.y]));
        }
        entry.marker.getElement()?.classList.toggle('rl-cursor-faded', now - c.at > CURSOR_FADE_MS);
      }
    };

    const snapshot = () => {
      const s = usePresenceStore.getState();
      render(
        s.cursors,
        Object.fromEntries(Object.entries(s.users).map(([id, p]) => [id, p.color])),
      );
    };
    snapshot();
    const unsubscribe = usePresenceStore.subscribe(snapshot);
    const fade = setInterval(snapshot, 1_000);
    return () => {
      unsubscribe();
      clearInterval(fade);
      for (const { marker } of markers.values()) marker.remove();
    };
  }, [map, names, meId]);

  return null;
}
