'use client';

import {
  MAPS,
  tileWorldSize,
  type Layer,
  type MapId,
  type SnapshotData,
} from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { ELEMENTS_PANE, textScale } from '@/components/map/ElementLayer';
import { ElementRenderer } from '@/components/map/elementRenderer';
import MapCanvas from '@/components/map/MapCanvas';
import type { ViewElement } from '@/stores/boardModel';

/** Snapshot data → the renderer's view shapes (read-only: seqs and authors don't matter). */
export function snapshotView(
  boardId: string,
  data: SnapshotData,
): { elements: Record<string, ViewElement>; layers: Layer[] } {
  return {
    layers: data.layers.map((l) => ({ ...l, boardId, seq: 0 })),
    elements: Object.fromEntries(
      data.elements.map((e) => [
        e.id,
        { ...e, boardId, seq: 0, updatedBy: null, updatedAt: new Date(0).toISOString() },
      ]),
    ),
  };
}

/** The same ElementRenderer the live board uses, fed from snapshot data instead of the store. */
function StaticElements({
  mapId,
  boardId,
  data,
}: {
  mapId: MapId;
  boardId: string;
  data: SnapshotData;
}) {
  const map = useMap();
  useEffect(() => {
    const config = MAPS[mapId];
    if (!map.getPane(ELEMENTS_PANE)) map.createPane(ELEMENTS_PANE).style.zIndex = '400';
    const canvas = L.canvas({ pane: ELEMENTS_PANE, padding: 0.5 });
    const renderer = new ElementRenderer(L, map, canvas, tileWorldSize(config));
    const container = map.getContainer();
    const view = snapshotView(boardId, data);
    const draw = () => {
      container.style.setProperty(
        '--rl-text-scale',
        String(textScale(map.getZoom(), config.maxNativeZoom)),
      );
      renderer.sync(view.elements, view.layers);
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
  }, [map, mapId, boardId, data]);
  return null;
}

/** Read-only map of a snapshot (UI_UX_SPEC §3.8): tiles + grid + its elements, no tools. */
export default function SnapshotPreviewMap({
  mapId,
  boardId,
  data,
}: {
  mapId: MapId;
  boardId: string;
  data: SnapshotData;
}) {
  return (
    <div
      className="h-[60dvh] min-h-80 overflow-hidden rounded-panel border"
      data-testid="snapshot-preview"
    >
      <MapCanvas mapId={mapId}>
        <StaticElements mapId={mapId} boardId={boardId} data={data} />
      </MapCanvas>
    </div>
  );
}
