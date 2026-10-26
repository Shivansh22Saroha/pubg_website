'use client';

import {
  PublicConfigResponseSchema,
  SessionsResponseSchema,
  UserResponseSchema,
  type ChangePasswordBody,
  type DeleteMeBody,
  type UpdateMeBody,
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

/** AUTH-6: other sessions are revoked server-side; this one stays. */
export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangePasswordBody) => api('/me/password', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
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
