'use client';

import { gridLines, SUB_CELLS } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toLatLng } from '@/lib/coords';

export const GRID_PANE = 'grid';
/** Minor (≈100 m) lines appear from this zoom up (≈25 px apart at zoom 3). */
export const MINOR_GRID_MIN_ZOOM = 3;

const MAJOR_STYLE: L.PolylineOptions = { color: '#E6EDF3', opacity: 0.6, weight: 1.25 };
const MINOR_STYLE: L.PolylineOptions = { color: '#E6EDF3', opacity: 0.2, weight: 1 };

function lines(
  worldSize: number,
  positions: number[],
  style: L.PolylineOptions,
  renderer: L.Renderer,
) {
  const group = L.layerGroup();
  for (const v of positions) {
    const opts = { ...style, renderer, interactive: false };
    group.addLayer(L.polyline([toLatLng([v, 0]), toLatLng([v, worldSize])], opts)); // vertical x = v
    group.addLayer(L.polyline([toLatLng([0, v]), toLatLng([worldSize, v])], opts)); // horizontal y = v
  }
  return group;
}

/** Major 1-square lines always; minor 1/10 lines at high zoom. Drawn on one canvas in its own pane. */
export function GridLayer({ worldSize, cells }: { worldSize: number; cells: number }) {
  const map = useMap();

  useEffect(() => {
    const renderer = L.canvas({ pane: GRID_PANE, padding: 0.5 });
    const majorPositions = gridLines(worldSize, cells);
    const minorPositions = gridLines(worldSize, cells * SUB_CELLS).filter(
      (_, i) => i % SUB_CELLS !== 0,
    );
    const major = lines(worldSize, majorPositions, MAJOR_STYLE, renderer).addTo(map);
    const minor = lines(worldSize, minorPositions, MINOR_STYLE, renderer);

    const sync = () => {
      if (map.getZoom() >= MINOR_GRID_MIN_ZOOM) minor.addTo(map);
      else minor.remove();
    };
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
      major.remove();
      minor.remove();
      renderer.remove(); // the canvas outlives its polylines unless removed explicitly
    };
  }, [map, worldSize, cells]);

  return null;
}
