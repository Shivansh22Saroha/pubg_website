'use client';

import {
  RestoreSnapshotResponseSchema,
  SnapshotDetailResponseSchema,
  SnapshotResponseSchema,
  SnapshotsResponseSchema,
} from '@rotationlab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const snapshotKeys = {
  list: (boardId: string) => ['board', boardId, 'snapshots'] as const,
  detail: (id: string) => ['snapshot', id] as const,
};

/** Snapshots of a board (API_SPEC §5), newest first; refetched whenever the drawer opens. */
export function useSnapshots(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: snapshotKeys.list(boardId),
    queryFn: async () =>
      (await api(`/boards/${boardId}/snapshots`, { schema: SnapshotsResponseSchema })).items,
    enabled,
    staleTime: 0,
  });
}

/** One snapshot with its data (for the read-only preview). Immutable → cached for good. */
export function useSnapshotDetail(id: string | null) {
  return useQuery({
    queryKey: snapshotKeys.detail(id ?? ''),
    queryFn: () => api(`/snapshots/${id ?? ''}`, { schema: SnapshotDetailResponseSchema }),
    enabled: id !== null,
    staleTime: Infinity,
  });
}

export function usePrefetchSnapshot() {
  const qc = useQueryClient();
  return (id: string) =>
    qc
      .query({
        queryKey: snapshotKeys.detail(id),
        queryFn: () => api(`/snapshots/${id}`, { schema: SnapshotDetailResponseSchema }),
        staleTime: Infinity,
      })
      .catch(() => undefined); // a prefetch: the preview shows its own error / retry
}

export function useCreateSnapshot(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api(`/boards/${boardId}/snapshots`, {
        method: 'POST',
        body: { name },
        schema: SnapshotResponseSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKeys.list(boardId) }),
  });
}

export function useRestoreSnapshot(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/snapshots/${id}/restore`, { method: 'POST', schema: RestoreSnapshotResponseSchema }),
    // the restore took an auto snapshot of the state it replaced
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKeys.list(boardId) }),
  });
}

export function useDeleteSnapshot(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/snapshots/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: snapshotKeys.list(boardId) }),
  });
}
