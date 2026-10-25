'use client';

import { MAPS, type MapId, type Pt } from '@rotationlab/shared';
import { CursorLayer } from './CursorLayer';
import { ElementLayer } from './ElementLayer';
import MapCanvas from './MapCanvas';

/** A live board: tiles + grid (MapCanvas) + elements + other users' cursors. Client-only. */
export default function BoardMap({
  mapId,
  meId,
  names,
  onCursor,
}: {
  mapId: MapId;
  meId: string;
  /** userId → display name, for cursor pills */
  names: Record<string, string>;
  onCursor: (pt: Pt | null) => void;
}) {
  return (
    <MapCanvas mapId={mapId} onCursor={onCursor}>
      <ElementLayer config={MAPS[mapId]} />
      <CursorLayer names={names} meId={meId} />
    </MapCanvas>
  );
}
