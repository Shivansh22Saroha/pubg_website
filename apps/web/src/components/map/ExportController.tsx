'use client';

import { MAP_IMAGERY_CREDIT } from '@rotationlab/shared';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { toast } from 'sonner';
import {
  collectExportSources,
  downloadBlob,
  exportFileName,
  footerText,
  renderExport,
} from '@/lib/exportPng';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** Runs a requested PNG export of this map's current viewport (FEATURES F12). */
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

  useEffect(() => {
    const container = map.getContainer();
    let handled = useWorkspaceStore.getState().exportRequest;
    return useWorkspaceStore.subscribe((s) => {
      if (s.exportRequest === handled) return;
      handled = s.exportRequest;
      const canvasEl = container.closest<HTMLElement>('[data-testid="map-canvas"]');
      const date = new Date();
      void collectExportSources(container, {
        variant: canvasEl?.dataset.variant === 'clean' ? 'clean' : 'labels',
        gridOn: canvasEl?.dataset.grid !== 'off',
        dpr: window.devicePixelRatio || 1,
        footer: footerText({
          room: roomName,
          board: boardName,
          map: mapName,
          date,
          credit: MAP_IMAGERY_CREDIT,
        }),
      })
        .then(renderExport)
        .then((blob) => {
          downloadBlob(blob, exportFileName(roomName, boardName, date));
          toast.success('PNG exported');
        })
        .catch((err: unknown) => {
          // a tainted canvas (tiles without CORS) throws SecurityError here
          toast.error(
            err instanceof Error && err.name === 'SecurityError'
              ? 'Export blocked: the map tiles are not CORS-enabled'
              : 'Export failed',
          );
        });
    });
  }, [map, roomName, boardName, mapName]);

  return null;
}
