'use client';

import { ThumbnailResponseSchema } from '@rotationlab/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { onLocalEdit } from '@/lib/localEdits';
import { keys } from '@/lib/queryKeys';
import { renderThumbnail } from '@/lib/thumbnail';
import { useBoardStore } from '@/stores/boardStore';

/** FEATURES F4: generated this long after the user's last edit of the board */
export const THUMBNAIL_DELAY_MS = 30_000;

/** E2E hook (window.__rlDebug.flushThumbnail): run the armed upload now instead of in 30 s */
let flushArmed: (() => Promise<boolean>) | null = null;
export const flushThumbnail = (): Promise<boolean> => flushArmed?.() ?? Promise.resolve(false);

/**
 * Phase 11 board thumbnails: 30 s after this user's last edit of the active board (each edit
 * restarts the clock), render a 256×256 JPEG of the board and `PUT` it. Editors only; viewers
 * never upload. Best effort: a failure is silent (the card keeps the previous image or the
 * map), and leaving the board before the 30 s cancels it.
 */
export function useThumbnailUploader(
  boardId: string | undefined,
  /** the board's map background (PUBG low-res art / a custom map's preview) and CRS span */
  map: { backgroundUrl: string; tileWorld: number } | null,
  canEdit: boolean,
) {
  const qc = useQueryClient();
  const backgroundUrl = map?.backgroundUrl;
  const tileWorld = map?.tileWorld;
  useEffect(() => {
    if (!boardId || !backgroundUrl || !tileWorld || !canEdit) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const upload = async (): Promise<boolean> => {
      timer = undefined;
      flushArmed = null;
      const s = useBoardStore.getState();
      if (s.boardId !== boardId || !s.ready) return false;
      const blob = await renderThumbnail({
        backgroundUrl,
        worldSize: tileWorld,
        elements: Object.values(s.view.elements),
        layers: s.view.layers,
      });
      if (!blob) return false;
      try {
        await api(`/boards/${boardId}/thumbnail`, {
          method: 'PUT',
          raw: { data: blob, type: 'image/jpeg' },
          schema: ThumbnailResponseSchema,
        });
        void qc.invalidateQueries({ queryKey: keys.rooms });
        return true;
      } catch {
        return false;
      }
    };

    const off = onLocalEdit((edited) => {
      if (edited !== boardId) return;
      clearTimeout(timer);
      timer = setTimeout(() => void upload(), THUMBNAIL_DELAY_MS);
      flushArmed = () => {
        clearTimeout(timer);
        return upload();
      };
    });
    return () => {
      off();
      clearTimeout(timer);
      flushArmed = null;
    };
  }, [boardId, backgroundUrl, tileWorld, canEdit, qc]);
}
