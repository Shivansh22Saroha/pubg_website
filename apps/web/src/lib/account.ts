'use client';

import {
  AVATAR_LIMITS,
  PrefsResponseSchema,
  PublicConfigResponseSchema,
  SessionsResponseSchema,
  UserResponseSchema,
  type ChangePasswordBody,
  type DeleteMeBody,
  type Me,
  type UpdateMeBody,
  type UpdatePrefsBody,
} from '@rotationlab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ME_QUERY_KEY } from '@/hooks/useMe';
import { api } from './api';

/** `GET /api/v1/config`: feature flags the UI needs before login (email flows on / off). */
export function usePublicConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api('/config', { schema: PublicConfigResponseSchema }),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeBody) =>
      api('/me', { method: 'PATCH', body, schema: UserResponseSchema }),
    onSuccess: ({ user }) => {
      qc.setQueryData(ME_QUERY_KEY, user);
    },
  });
}

/**
 * Profile photo (FEATURES F23). The room member lists carry photo URLs too, so open rooms are
 * refetched after a change.
 */
export function useSetAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const blob = await prepareAvatarImage(file);
      return api('/me/avatar', {
        method: 'PUT',
        raw: { data: blob, type: blob.type || 'image/webp' },
        schema: UserResponseSchema,
      });
    },
    onSuccess: ({ user }) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ['room'] });
    },
  });
}

export function useRemoveAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/me/avatar', { method: 'DELETE', schema: UserResponseSchema }),
    onSuccess: ({ user }) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ['room'] });
    },
  });
}

/**
 * Crops a picked photo to its centre square and shrinks it to 512 px in the browser (F23), so a
 * 10 MB phone photo uploads as a few dozen KB. The server still checks and re-encodes it.
 */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  if (file.size > AVATAR_LIMITS.fileMaxBytes) throw new Error('Photo is larger than 15 MB');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WebP image');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Couldn’t read that image — try another file');
  });
  try {
    const { width, height } = bitmap;
    const side = Math.min(width, height);
    if (side < AVATAR_LIMITS.minSidePx)
      throw new Error(`Photo must be at least ${AVATAR_LIMITS.minSidePx} px on each side`);
    const out = Math.min(side, AVATAR_LIMITS.uploadPx);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t read that image — try another file');
    ctx.drawImage(bitmap, (width - side) / 2, (height - side) / 2, side, side, 0, 0, out, out);
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, type, 0.9);
      });
    let blob = await encode('image/webp');
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg'); // Safari < 17
    if (!blob || blob.size > AVATAR_LIMITS.uploadMaxBytes)
      throw new Error('Couldn’t read that image — try another file');
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Phase 9: server-side UI prefs (the room tour). Optimistic: the cached `me` changes at once,
 * so a failed request never shows the tour twice in this tab.
 */
export function useUpdatePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePrefsBody) =>
      api('/me/prefs', { method: 'PATCH', body, schema: PrefsResponseSchema }),
    onMutate: (body) => {
      qc.setQueryData<Me>(ME_QUERY_KEY, (me) =>
        me ? { ...me, prefs: { ...me.prefs, ...body } } : me,
      );
    },
    onSuccess: ({ prefs }) => {
      qc.setQueryData<Me>(ME_QUERY_KEY, (me) => (me ? { ...me, prefs } : me));
    },
  });
}

/** AUTH-6: other sessions are revoked server-side; this one stays. */
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangePasswordBody) => api('/me/password', { method: 'POST', body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY }); // a first password flips hasPassword
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await api('/me/sessions', { schema: SessionsResponseSchema })).items,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function deleteAccount(body: DeleteMeBody) {
  return api('/me', { method: 'DELETE', body });
}

export const resendVerification = () => api('/auth/resend-verification', { method: 'POST' });
export const verifyEmail = (token: string) =>
  api('/auth/verify-email', { method: 'POST', body: { token } });
export const forgotPassword = (email: string) =>
  api('/auth/forgot-password', { method: 'POST', body: { email } });
export const resetPassword = (token: string, password: string) =>
  api('/auth/reset-password', { method: 'POST', body: { token, password } });
