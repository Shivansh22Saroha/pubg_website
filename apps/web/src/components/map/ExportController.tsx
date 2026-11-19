'use client';

import { MAP_IMAGERY_CREDIT } from '@rotationlab/shared';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toast } from 'sonner';
import { useBoardMapInfo } from '@/components/map/boardMapContext';
import {
  downloadBlob,
  EXPORT_SCALE,
  exportFileName,
  footerText,
  WHOLE_MAP_CSS_PX,
  wholeMapRect,
  type WorldRect,
} from '@/lib/exportPng';
import { withPlayerLabels } from '@/lib/linkedPlayers';
import { useBoardStore } from '@/stores/boardStore';
import { usePlayersStore } from '@/stores/playersStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { renderBoardExport } from './exportRender';

/**
 * Runs a requested PNG export (FEATURES F12): the current view at 2× its size, or the whole
 * map as a 4096 px square — both rendered fresh at full sharpness, not copied off the screen.
 */
export function ExportController({
  roomName,
  boardName,
  mapName,
}: {
  roomName: string;
  boardName: string;
  mapName: string;
}) {
  const map = useMap();
  const info = useBoardMapInfo();

  useEffect(() => {
    if (!info) return;
    const container = map.getContainer();
    let handled = useWorkspaceStore.getState().exportRequest?.n ?? 0;
    let busy = false;
    return useWorkspaceStore.subscribe((s) => {
      const request = s.exportRequest;
      if (!request || request.n === handled) return;
      handled = request.n;
      if (busy) return;
      busy = true;

      const canvasEl = container.closest<HTMLElement>('[data-testid="map-canvas"]');
      const date = new Date();
      // what the board shows right now: hidden layers (incl. this tab's Alt+click) stay hidden
      const { view } = useBoardStore.getState();
      const { hiddenLayers } = useSelectionStore.getState();
      const layers = view.layers.map((l) => (hiddenLayers[l.id] ? { ...l, visible: false } : l));
      const elements = withPlayerLabels(
        view.elements,
        usePlayersStore.getState().byId,
        new WeakMap(),
      );

      let rect: WorldRect;
      let cssWidth: number;
      let cssHeight: number;
      if (request.area === 'map') {
        rect = wholeMapRect(info.worldSize);
        cssWidth = cssHeight = WHOLE_MAP_CSS_PX;
      } else {
        const b = map.getBounds(); // lat = y, lng = x (world units)
        rect = { x0: b.getWest(), y0: b.getSouth(), x1: b.getEast(), y1: b.getNorth() };
        if (rect.y0 > rect.y1) [rect.y0, rect.y1] = [rect.y1, rect.y0];
        cssWidth = container.clientWidth;
        cssHeight = container.clientHeight;
      }

      const toastId = toast.loading(
        request.area === 'map' ? 'Preparing the whole map…' : 'Preparing PNG…',
      );
      renderBoardExport({
        info,
        elements,
        layers,
        variant: canvasEl?.dataset.variant === 'clean' ? 'clean' : 'labels',
        grid: canvasEl?.dataset.grid !== 'off',
        rect,
        cssWidth,
        cssHeight,
        footer: footerText({
          room: roomName,
          board: boardName,
          map: mapName,
          date,
          // an uploaded map isn't KRAFTON's art
          credit: info.kind === 'pubg' ? MAP_IMAGERY_CREDIT : '',
        }),
      })
        .then((blob) => {
          downloadBlob(
            blob,
            exportFileName(roomName, request.area === 'map' ? `${boardName}-map` : boardName, date),
          );
          toast.success(
            `PNG exported (${Math.round(cssWidth * EXPORT_SCALE)}×${Math.round(cssHeight * EXPORT_SCALE)})`,
            { id: toastId },
          );
        })
        .catch((err: unknown) => {
          // a tainted canvas (images without CORS) throws SecurityError here
          toast.error(
            err instanceof Error && err.name === 'SecurityError'
              ? 'Export blocked: the map images are not CORS-enabled'
              : 'Export failed',
            { id: toastId },
          );
        })
        .finally(() => {
          busy = false;
        });
    });
  }, [map, info, roomName, boardName, mapName]);

  return null;
}
