'use client';

import { tileWorldSize, type MapConfig } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useBoardStore } from '@/stores/boardStore';
import { ElementRenderer } from './elementRenderer';

export const ELEMENTS_PANE = 'elements';

/** Text labels scale with zoom between 0.75× and 1.5×, then clamp (UI_UX_SPEC §6). */
function textScale(zoom: number, maxNativeZoom: number) {
  return Math.min(1.5, Math.max(0.75, 2 ** (zoom - (maxNativeZoom - 2))));
}

/**
 * Board elements from the store, rendered by `ElementRenderer` (diffed by id/identity) on one
 * shared canvas renderer in its own pane above the grid. Subscribes to the store directly so
 * a remote op never re-renders React.
 */
export function ElementLayer({ config }: { config: MapConfig }) {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(ELEMENTS_PANE)) map.createPane(ELEMENTS_PANE).style.zIndex = '400';
    const canvas = L.canvas({ pane: ELEMENTS_PANE, padding: 0.5 });
    const renderer = new ElementRenderer(L, map, canvas, tileWorldSize(config));
    const container = map.getContainer();
    const applyScale = () => {
      container.style.setProperty(
        '--rl-text-scale',
        String(textScale(map.getZoom(), config.maxNativeZoom)),
      );
    };

    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { view } = useBoardStore.getState();
        renderer.sync(view.elements, view.layers);
      });
    };
    const onZoom = () => {
      applyScale();
      renderer.onZoom();
      sync();
    };

    applyScale();
    sync();
    const unsubscribe = useBoardStore.subscribe((s, prev) => {
      if (s.view !== prev.view) sync();
    });
    map.on('zoomend', onZoom);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      map.off('zoomend', onZoom);
      renderer.destroy();
      canvas.remove();
    };
  }, [map, config]);

  return null;
}
