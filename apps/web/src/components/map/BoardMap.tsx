'use client';

import { MAPS, type MapId, type Pt, type RoomRole } from '@rotationlab/shared';
import { useMemo } from 'react';
import { StyleBar } from '@/components/tools/StyleBar';
import { ToolLayer } from '@/components/tools/ToolLayer';
import { makeNameOf } from '@/lib/editing';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { useBoardStore } from '@/stores/boardStore';
import { CursorLayer } from './CursorLayer';
import { ElementLayer } from './ElementLayer';
import MapCanvas from './MapCanvas';

/** UI_UX_SPEC §9: shown on an empty board to people who can draw. */
function EmptyHint() {
  const empty = useBoardStore((s) => s.ready && Object.keys(s.view.elements).length === 0);
  if (!empty) return null;
  return (
    <p className="pointer-events-none absolute inset-x-0 top-1/3 z-[500] text-center text-sm text-text-muted [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
      Pick a tool on the left and start drawing. Press ? for shortcuts.
    </p>
  );
}

/**
 * A live board: tiles + grid (MapCanvas) + elements + other users' cursors, and the drawing
 * tools with their selection overlay and style bar. Client-only.
 */
export default function BoardMap({
  mapId,
  meId,
  names,
  onCursor,
  session,
  role,
  roomName,
}: {
  mapId: MapId;
  meId: string;
  /** userId → display name, for cursor pills and "Changed by …" */
  names: Record<string, string>;
  onCursor: (pt: Pt | null) => void;
  session: RoomSession | null;
  role: RoomRole;
  roomName: string;
}) {
  const config = MAPS[mapId];
  const nameOf = useMemo(() => makeNameOf(meId, names), [meId, names]);
  return (
    <MapCanvas
      mapId={mapId}
      onCursor={onCursor}
      overlay={
        <>
          {role !== 'VIEWER' && <EmptyHint />}
          <StyleBar role={role} mapId={mapId} session={session} nameOf={nameOf} />
        </>
      }
    >
      <ElementLayer config={config} />
      <ToolLayer
        config={config}
        session={session}
        role={role}
        roomName={roomName}
        meId={meId}
        names={names}
      />
      <CursorLayer names={names} meId={meId} />
    </MapCanvas>
  );
}
