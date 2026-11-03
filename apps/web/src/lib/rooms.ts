'use client';

import {
  AcceptInviteResponseSchema,
  BoardResponseSchema,
  BoardStateResponseSchema,
  CreateRoomResponseSchema,
  InviteResponseSchema,
  InvitesResponseSchema,
  MemberResponseSchema,
  RoomBansResponseSchema,
  RoomDetailResponseSchema,
  RoomListResponseSchema,
  RoomResponseSchema,
  type AssignableRole,
  type CreateBoardBody,
  type CreateInviteBody,
  type CreateRoomBody,
  type UpdateBoardBody,
  type UpdateRoomBody,
} from '@rotationlab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { keys } from './queryKeys';

export { keys };

export function useRooms() {
  return useQuery({
    queryKey: keys.rooms,
    queryFn: async ({ signal }) =>
      (await api('/rooms', { schema: RoomListResponseSchema, signal })).items,
  });
}

export function useRoom(roomId: string) {
  return useQuery({
    queryKey: keys.room(roomId),
    queryFn: ({ signal }) => api(`/rooms/${roomId}`, { schema: RoomDetailResponseSchema, signal }),
  });
}

export function useBoardState(boardId: string | undefined) {
  return useQuery({
    queryKey: keys.boardState(boardId ?? ''),
    enabled: Boolean(boardId),
    queryFn: ({ signal }) =>
      api(`/boards/${boardId ?? ''}/state`, { schema: BoardStateResponseSchema, signal }),
  });
}

export function useInvites(roomId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.invites(roomId),
    enabled,
    queryFn: async ({ signal }) =>
      (await api(`/rooms/${roomId}/invites`, { schema: InvitesResponseSchema, signal })).items,
  });
}

/** Mutations that change a room refetch its detail and the dashboard list. */
function useRoomMutation<TVars, TResult>(roomId: string, fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.room(roomId) }),
        qc.invalidateQueries({ queryKey: keys.rooms }),
      ]);
    },
  });
}

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoomBody) =>
      api('/rooms', { method: 'POST', body, schema: CreateRoomResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rooms }),
  });
}

export function useUpdateRoom(roomId: string) {
  return useRoomMutation(roomId, (body: UpdateRoomBody) =>
    api(`/rooms/${roomId}`, { method: 'PATCH', body, schema: RoomResponseSchema }),
  );
}

export function useSetRoomPassword(roomId: string) {
  return useRoomMutation(roomId, (password: string | null) =>
    api(`/rooms/${roomId}/password`, { method: 'PUT', body: { password } }),
  );
}

export function useDeleteRoom(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmName: string) =>
      api(`/rooms/${roomId}`, { method: 'DELETE', body: { confirmName } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rooms }),
  });
}

export function useLeaveRoom(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/rooms/${roomId}/leave`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rooms }),
  });
}

export function useTransferRoom(roomId: string) {
  return useRoomMutation(roomId, (body: { userId: string; password: string }) =>
    api(`/rooms/${roomId}/transfer`, { method: 'POST', body }),
  );
}

export function useSetMemberRole(roomId: string) {
  return useRoomMutation(roomId, ({ userId, role }: { userId: string; role: AssignableRole }) =>
    api(`/rooms/${roomId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
      schema: MemberResponseSchema,
    }),
  );
}

export function useKickMember(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ban }: { userId: string; ban: boolean }) =>
      api(`/rooms/${roomId}/members/${userId}`, { method: 'DELETE', body: { ban } }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.room(roomId) }),
        qc.invalidateQueries({ queryKey: keys.bans(roomId) }),
      ]);
    },
  });
}

export function useBans(roomId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.bans(roomId),
    enabled,
    queryFn: async ({ signal }) =>
      (await api(`/rooms/${roomId}/bans`, { schema: RoomBansResponseSchema, signal })).items,
  });
}

export function useUnban(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api(`/rooms/${roomId}/bans/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.bans(roomId) }),
  });
}

export function useCreateInvite(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInviteBody) =>
      api(`/rooms/${roomId}/invites`, { method: 'POST', body, schema: InviteResponseSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites(roomId) }),
  });
}

export function useRevokeInvite(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api(`/rooms/${roomId}/invites/${inviteId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites(roomId) }),
  });
}

export function useAcceptInvite(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password?: string) =>
      api(`/invites/${code}/accept`, {
        method: 'POST',
        body: password ? { password } : {},
        schema: AcceptInviteResponseSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rooms }),
  });
}

export function useCreateBoard(roomId: string) {
  return useRoomMutation(roomId, (body: CreateBoardBody) =>
    api(`/rooms/${roomId}/boards`, { method: 'POST', body, schema: BoardResponseSchema }),
  );
}

export function useUpdateBoard(roomId: string) {
  return useRoomMutation(roomId, ({ boardId, ...body }: UpdateBoardBody & { boardId: string }) =>
    api(`/boards/${boardId}`, { method: 'PATCH', body, schema: BoardResponseSchema }),
  );
}

export function useDeleteBoard(roomId: string) {
  return useRoomMutation(roomId, (boardId: string) =>
    api(`/boards/${boardId}`, { method: 'DELETE' }),
  );
}
