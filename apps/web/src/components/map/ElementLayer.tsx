'use client';

import { tileWorldSize, type MapConfig } from '@rotationlab/shared';
import L from 'leaflet';
import { env } from '@/env';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { withTransform } from '@/components/tools/scene';
import { withPlayerLabels } from '@/lib/linkedPlayers';
import { useBoardStore } from '@/stores/boardStore';
import type { ViewElement } from '@/stores/boardModel';
import { usePlayersStore } from '@/stores/playersStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { ElementRenderer } from './elementRenderer';

export const ELEMENTS_PANE = 'elements';

/** loot item icons are deployed next to the tiles (Phase 12) */
const ICON_BASE = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');
/** Text labels scale with zoom between 0.75× and 1.5×, then clamp (UI_UX_SPEC §6). */
export function textScale(zoom: number, maxNativeZoom: number) {
  return Math.min(1.5, Math.max(0.75, 2 ** (zoom - (maxNativeZoom - 2))));
}

/**
 * Board elements from the store, rendered by `ElementRenderer` (diffed by id/identity) on one
 * shared canvas renderer in its own pane above the grid. Subscribes to the store directly so
 * a remote op never re-renders React. An in-progress move / resize drag is drawn from the
 * selection store's transform, and layers hidden in this tab only (Alt+click) stay off.
 */
export function ElementLayer({ config }: { config: MapConfig }) {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(ELEMENTS_PANE)) map.createPane(ELEMENTS_PANE).style.zIndex = '400';
    const canvas = L.canvas({ pane: ELEMENTS_PANE, padding: 0.5 });
    const renderer = new ElementRenderer(L, map, canvas, tileWorldSize(config), ICON_BASE);
    const container = map.getContainer();
    const applyScale = () => {
      container.style.setProperty(
        '--rl-text-scale',
        String(textScale(map.getZoom(), config.maxNativeZoom)),
      );
    };

    const labelCache = new WeakMap<ViewElement, { name: string | undefined; out: ViewElement }>();
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { view } = useBoardStore.getState();
        const { transform, hiddenLayers } = useSelectionStore.getState();
        const layers = view.layers.some((l) => hiddenLayers[l.id])
          ? view.layers.map((l) => (hiddenLayers[l.id] ? { ...l, visible: false } : l))
          : view.layers;
        // linked own-player markers show their member's IGN (Phase 12)
        const named = withPlayerLabels(view.elements, usePlayersStore.getState().byId, labelCache);
        renderer.sync(withTransform(named, transform), layers);
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
    const offSelection = useSelectionStore.subscribe((s, prev) => {
      if (s.transform !== prev.transform || s.hiddenLayers !== prev.hiddenLayers) sync();
    });
    const offPlayers = usePlayersStore.subscribe((s, prev) => {
      if (s.byId !== prev.byId) sync();
    });
    map.on('zoomend', onZoom);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      offSelection();
      offPlayers();
      map.off('zoomend', onZoom);
      renderer.destroy();
      canvas.remove();
    };
  }, [map, config]);

  return null;
}
