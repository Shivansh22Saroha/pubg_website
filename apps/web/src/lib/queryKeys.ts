/**
 * React Query keys. A plain module (no 'use client') so server components can seed the same
 * cache entries the client hooks read (`src/lib/serverApi.ts`).
 */
export const ME_QUERY_KEY = ['me'] as const;

export const keys = {
  rooms: ['rooms'] as const,
  room: (id: string) => ['room', id] as const,
  invites: (id: string) => ['room', id, 'invites'] as const,
  bans: (id: string) => ['room', id, 'bans'] as const,
  boardState: (id: string) => ['board', id, 'state'] as const,
  share: (boardId: string) => ['board', boardId, 'share'] as const,
  sharedBoard: (token: string) => ['public', 'share', token] as const,
};
