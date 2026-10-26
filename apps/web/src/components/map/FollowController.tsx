'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { useBoardStore } from '@/stores/boardStore';
import { useFollowStore } from '@/stores/followStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** MapHud & co. dispatch this on window when the user pans / zooms with a button. */
export const MANUAL_VIEW_EVENT = 'rl:manual-view';
const SMOOTH_SECONDS = 0.2; // FEATURES F8: 200 ms smoothing
/** while followed, re-send my view this often: view:update is volatile and may be dropped */
export const VIEW_RESEND_MS = 1_500;

const PAN_ZOOM_KEYS = new Set([
  '+',
  '-',
  '=',
  '_',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * Follow mode on the map (FEATURES F8).
 * - Leader: while anyone follows (`followers:update`), every move / zoom is sent as
 *   `view:update` (≤ 10 Hz, best-effort), plus once right away.
 * - Follower: the leader's latest view for this board is applied with 200 ms smoothing. Any pan
 *   or zoom the follower makes themselves — drag, wheel, double-click, keys, HUD buttons —
 *   stops following. Programmatic moves never count, so no "is this mine?" bookkeeping.
 */
export function FollowController({
  boardId,
  session,
}: {
  boardId: string;
  session: RoomSession | null;
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const sendView = (force = false) => {
      const c = map.getCenter();
      session?.viewUpdate([c.lng, c.lat], map.getZoom(), force);
    };
    const onMove = () => {
      sendView();
    };
    map.on('move zoomend', onMove);
    if (useWorkspaceStore.getState().followerCount > 0) sendView(true);
    // switching boards: followers need my view once this board is subscribed (the server only
    // relays view:update for the board my socket is on)
    const offBoard = useBoardStore.subscribe((s, prev) => {
      if (s.boardId === boardId && s.ready && !(prev.boardId === boardId && prev.ready))
        sendView(true);
    });
    const offFollowers = useWorkspaceStore.subscribe((s, prev) => {
      // a new follower (or a summon) gets my view right away, not at my next move
      if (s.followerCount > prev.followerCount) sendView(true);
    });

    const resend = setInterval(() => {
      if (useWorkspaceStore.getState().followerCount > 0) sendView(true);
    }, VIEW_RESEND_MS);

    // ---- follower -----------------------------------------------------------------------
    const apply = () => {
      const { leaderId, view } = useFollowStore.getState();
      if (!leaderId || view?.boardId !== boardId) return;
      map.setView([view.center[1], view.center[0]], view.zoom, {
        animate: true,
        duration: SMOOTH_SECONDS,
      });
    };
    apply();
    const offFollow = useFollowStore.subscribe((s, prev) => {
      if (s.view !== prev.view) apply();
    });

    const manual = () => {
      if (useFollowStore.getState().leaderId)
        useFollowStore.getState().dispatch({ type: 'manualMove' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (PAN_ZOOM_KEYS.has(e.key)) manual();
    };
    map.on('dragstart', manual);
    map.on('dblclick', manual);
    container.addEventListener('wheel', manual, { passive: true });
    container.addEventListener('keydown', onKey);
    window.addEventListener(MANUAL_VIEW_EVENT, manual);

    return () => {
      map.off('move zoomend', onMove);
      clearInterval(resend);
      offFollowers();
      offBoard();
      offFollow();
      map.off('dragstart', manual);
      map.off('dblclick', manual);
      container.removeEventListener('wheel', manual);
      container.removeEventListener('keydown', onKey);
      window.removeEventListener(MANUAL_VIEW_EVENT, manual);
    };
  }, [map, boardId, session]);

  return null;
}
