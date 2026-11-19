'use client';

import {
  CUSTOM_MAP_LIMITS,
  CustomMapListResponseSchema,
  CustomMapResponseSchema,
  type CustomMap,
  type UpdateCustomMapBody,
} from '@rotationlab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from './queryKeys';

/** refetch well before the signed image URLs expire (they live ≥ 6 h; see SIGN_WINDOW_MS) */
const REFRESH_MS = 30 * 60 * 1000;

/** A room's custom maps (FEATURES F20), with signed image URLs. */
export function useCustomMaps(roomId: string, enabled = true) {
  return useQuery({
    queryKey: keys.customMaps(roomId),
    enabled,
    queryFn: ({ signal }) =>
      api(`/rooms/${roomId}/custom-maps`, { schema: CustomMapListResponseSchema, signal }).then(
        (r) => r.items,
      ),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });
}

export function useUploadCustomMap(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name, widthM }: { file: Blob; name: string; widthM: number }) => {
      const q = new URLSearchParams({ name, widthM: String(widthM) });
      return api(`/rooms/${roomId}/custom-maps?${q.toString()}`, {
        method: 'POST',
        raw: { data: file, type: file.type || 'image/webp' },
        schema: CustomMapResponseSchema,
      }).then((r) => r.customMap);
    },
    onSuccess: (map) => {
      qc.setQueryData<CustomMap[]>(keys.customMaps(roomId), (prev) => [...(prev ?? []), map]);
    },
  });
}

export function useUpdateCustomMap(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCustomMapBody }) =>
      api(`/rooms/${roomId}/custom-maps/${id}`, {
        method: 'PATCH',
        body,
        schema: CustomMapResponseSchema,
      }).then((r) => r.customMap),
    onSuccess: (map) => {
      qc.setQueryData<CustomMap[]>(keys.customMaps(roomId), (prev) =>
        (prev ?? []).map((m) => (m.id === map.id ? map : m)),
      );
    },
  });
}

export function useDeleteCustomMap(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/rooms/${roomId}/custom-maps/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: (id) => {
      qc.setQueryData<CustomMap[]>(keys.customMaps(roomId), (prev) =>
        (prev ?? []).filter((m) => m.id !== id),
      );
    },
  });
}

/**
 * Shrinks a picked image in the browser before upload (FEATURES F20): longest side ≤ 4096 px,
 * re-encoded as WebP (JPEG where the browser can't write WebP). Phone photos of maps are often
 * 10+ MB; this sends a few MB instead. The server still validates and re-encodes everything.
 */
export async function prepareMapImage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.size > CUSTOM_MAP_LIMITS.fileMaxBytes) throw new Error('Image is larger than 15 MB');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WebP image');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Couldn’t read that image — try another file');
  });
  try {
    const { width, height } = bitmap;
    if (Math.max(width, height) < CUSTOM_MAP_LIMITS.minSidePx)
      throw new Error(
        `Image must be at least ${CUSTOM_MAP_LIMITS.minSidePx} px on its longer side`,
      );
    const scale = Math.min(1, CUSTOM_MAP_LIMITS.maxSidePx / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    // small enough already, and a format the server takes: send the file as it is
    if (scale === 1 && file.size <= CUSTOM_MAP_LIMITS.uploadMaxBytes) {
      return { blob: file, width: w, height: h };
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t read that image — try another file');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const encode = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, type, quality);
      });
    let blob = await encode('image/webp', 0.9);
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg', 0.9); // Safari < 17
    for (let q = 0.8; blob && blob.size > CUSTOM_MAP_LIMITS.uploadMaxBytes && q > 0.4; q -= 0.15)
      blob = await encode(blob.type, q);
    if (!blob || blob.size > CUSTOM_MAP_LIMITS.uploadMaxBytes)
      throw new Error('Couldn’t make that image small enough — try a smaller file');
    return { blob, width: w, height: h };
  } finally {
    bitmap.close();
  }
}
