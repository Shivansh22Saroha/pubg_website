'use client';

import { MAPS, type MapId, type Pt, type RoomRole } from '@rotationlab/shared';
import { useMemo } from 'react';
import { FollowPill } from '@/components/room/FollowPill';
import { StyleBar } from '@/components/tools/StyleBar';
import { ToolLayer } from '@/components/tools/ToolLayer';
import { isTouchLayout, useBreakpoint } from '@/hooks/useBreakpoint';
import { makeNameOf } from '@/lib/editing';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { useBoardStore } from '@/stores/boardStore';
import { CursorLayer } from './CursorLayer';
import { ExportController } from './ExportController';
import { BoardTransition, RewindFlash } from './BoardFx';
import { ElementLayer } from './ElementLayer';
import { FollowController } from './FollowController';
import { LaserLayer } from './LaserLayer';
import MapCanvas from './MapCanvas';
import { PingLayer } from './PingLayer';

/** UI_UX_SPEC §9: shown on an empty board to people who can draw. */
function EmptyHint() {
  const empty = useBoardStore((s) => s.ready && Object.keys(s.view.elements).length === 0);
  const touch = isTouchLayout(useBreakpoint());
  if (!empty) return null;
  return (
    <p
      data-testid="empty-hint"
      className="pointer-events-none absolute inset-x-0 top-1/3 z-[500] px-4 text-center text-sm text-text [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]"
    >
      {touch
        ? 'Pick a tool and start drawing.'
        : 'Pick a tool on the left and start drawing. Press ? for shortcuts.'}
    </p>
  );
}

/**
 * A live board: tiles + grid (MapCanvas) + elements + other users' cursors, the drawing tools
 * with their selection overlay and style bar, pings, laser trails and follow mode. Client-only.
 */
export default function BoardMap({
  boardId,
  mapId,
  meId,
  names,
  onCursor,
  session,
  role,
  roomName,
  boardName,
}: {
  boardId: string;
  mapId: MapId;
  meId: string;
  /** userId → display name, for cursor pills and "Changed by …" */
  names: Record<string, string>;
  onCursor: (pt: Pt | null) => void;
  session: RoomSession | null;
  role: RoomRole;
  roomName: string;
  boardName: string;
}) {
  const config = MAPS[mapId];
  const nameOf = useMemo(() => makeNameOf(meId, names), [meId, names]);
  return (
    <MapCanvas
      minimap
      mapId={mapId}
      onCursor={onCursor}
      overlay={
        <>
          {role !== 'VIEWER' && <EmptyHint />}
          <FollowPill names={names} />
          <RewindFlash />
          <StyleBar role={role} mapId={mapId} session={session} nameOf={nameOf} />
        </>
      }
    >
      <BoardTransition boardId={boardId} />
      <ElementLayer config={config} meId={meId} />
      <ToolLayer
        config={config}
        session={session}
        role={role}
        roomName={roomName}
        meId={meId}
        names={names}
      />
      <CursorLayer names={names} meId={meId} />
      <PingLayer config={config} boardId={boardId} />
      <LaserLayer meId={meId} />
      <FollowController boardId={boardId} session={session} />
      <ExportController roomName={roomName} boardName={boardName} mapName={config.name} />
    </MapCanvas>
  );
}
