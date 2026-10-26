'use client';

import type { Layer, MapId, SnapshotData } from '@rotationlab/shared';
import { useMemo } from 'react';
import MapCanvas from '@/components/map/MapCanvas';
import { StaticElements } from '@/components/map/StaticElements';
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
  const view = useMemo(() => snapshotView(boardId, data), [boardId, data]);
  return (
    <div
      className="h-[60dvh] min-h-80 overflow-hidden rounded-panel border"
      data-testid="snapshot-preview"
    >
      <MapCanvas mapId={mapId}>
        <StaticElements mapId={mapId} elements={view.elements} layers={view.layers} />
      </MapCanvas>
    </div>
  );
}
