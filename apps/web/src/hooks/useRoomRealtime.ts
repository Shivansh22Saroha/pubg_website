'use client';

import type { Pt } from '@rotationlab/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomSession, type RoomSessionCallbacks } from '@/lib/realtime/roomSession';

/**
 * Owns the RoomSession for the room screen: started on mount, re-pointed when the active board
 * changes, stopped on unmount. Callbacks are read through a ref so they can change freely.
 */
export function useRoomRealtime(
  roomId: string,
  meId: string | undefined,
  boardId: string | undefined,
  callbacks: RoomSessionCallbacks,
) {
  const queryClient = useQueryClient();
  const cb = useRef(callbacks);
  useEffect(() => {
    cb.current = callbacks;
  });
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    if (!meId) return;
    const s = new RoomSession(roomId, meId, queryClient, {
      onKicked: () => {
        cb.current.onKicked();
      },
      onRoomDeleted: () => {
        cb.current.onRoomDeleted();
      },
      onActiveBoardDeleted: (b) => {
        cb.current.onActiveBoardDeleted(b);
      },
      onRoleChanged: (r) => {
        cb.current.onRoleChanged(r);
      },
      onReject: (m) => {
        cb.current.onReject(m);
      },
    });
    s.start();
    setSession(s);
    return () => {
      s.stop();
      setSession(null);
    };
  }, [roomId, meId, queryClient]);

  useEffect(() => {
    if (session && boardId) session.setBoard(boardId);
  }, [session, boardId]);

  const onCursor = useCallback(
    (pt: Pt | null) => {
      if (pt) session?.cursor(pt[0], pt[1]);
    },
    [session],
  );

  return { session, onCursor };
}
