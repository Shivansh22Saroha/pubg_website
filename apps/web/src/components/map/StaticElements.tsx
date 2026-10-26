'use client';

import { MAPS, tileWorldSize, type Layer, type MapId } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { ELEMENTS_PANE, textScale } from '@/components/map/ElementLayer';
import { ElementRenderer } from '@/components/map/elementRenderer';
import type { ViewElement } from '@/stores/boardModel';

/**
 * The same ElementRenderer the live board uses, fed from fixed data instead of the board store
 * (snapshot previews, the /explore demo boards). Hidden layers stay hidden.
 */
export function StaticElements({
  mapId,
  elements,
  layers,
}: {
  mapId: MapId;
  elements: Record<string, ViewElement>;
  layers: Layer[];
}) {
  const map = useMap();
  useEffect(() => {
    const config = MAPS[mapId];
    if (!map.getPane(ELEMENTS_PANE)) map.createPane(ELEMENTS_PANE).style.zIndex = '400';
    const canvas = L.canvas({ pane: ELEMENTS_PANE, padding: 0.5 });
    const renderer = new ElementRenderer(L, map, canvas, tileWorldSize(config));
    const container = map.getContainer();
    const draw = () => {
      container.style.setProperty(
        '--rl-text-scale',
        String(textScale(map.getZoom(), config.maxNativeZoom)),
      );
      renderer.sync(elements, layers);
    };
    const onZoom = () => {
      renderer.onZoom();
      draw();
    };
    draw();
    map.on('zoomend', onZoom);
    return () => {
      map.off('zoomend', onZoom);
      renderer.destroy();
      canvas.remove();
    };
  }, [map, mapId, elements, layers]);
  return null;
}
