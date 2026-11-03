'use client';

import {
  SharedBoardResponseSchema,
  ShareLinkCreatedResponseSchema,
  ShareLinkStatusResponseSchema,
  ShareTokenSchema,
  type ShareExpiry,
} from '@rotationlab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { ExploreBoard } from './explore';
import { keys } from './queryKeys';

/** Phase 11 — a board's public read-only link (FEATURES F4b). Owner / editor only. */
export function useShareStatus(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.share(boardId),
    enabled,
    queryFn: async ({ signal }) =>
      (await api(`/boards/${boardId}/share`, { schema: ShareLinkStatusResponseSchema, signal }))
        .share,
  });
}

/** Create or regenerate: the response is the only place the URL ever appears. */
export function useCreateShare(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expiresIn: ShareExpiry) =>
      api(`/boards/${boardId}/share`, {
        method: 'POST',
        body: { expiresIn },
        schema: ShareLinkCreatedResponseSchema,
      }),
    onSuccess: ({ share }) => {
      qc.setQueryData(keys.share(boardId), share);
    },
  });
}

export function useRevokeShare(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/boards/${boardId}/share`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.setQueryData(keys.share(boardId), null);
    },
  });
}

export type SharedBoardResult =
  | { status: 'ok'; board: ExploreBoard; expiresAt: string | null }
  | { status: 'gone' | 'limited' | 'error' };

/** `/s/[token]`: the board as it is now. A malformed token never reaches the API. */
export async function loadSharedBoard(
  token: string,
  signal?: AbortSignal,
): Promise<SharedBoardResult> {
  if (!ShareTokenSchema.safeParse(token).success) return { status: 'gone' };
  try {
    const res = await api(`/public/share/${token}`, {
      schema: SharedBoardResponseSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      status: 'ok',
      expiresAt: res.expiresAt,
      board: {
        mapId: res.board.mapId,
        name: res.board.name,
        layers: res.layers,
        elements: Object.fromEntries(res.elements.map((e) => [e.id, e])),
      },
    };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400))
      return { status: 'gone' };
    if (err instanceof ApiError && err.status === 429) return { status: 'limited' };
    return { status: 'error' };
  }
}

export function useSharedBoard(token: string) {
  return useQuery({
    queryKey: keys.sharedBoard(token),
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => loadSharedBoard(token, signal),
  });
}
