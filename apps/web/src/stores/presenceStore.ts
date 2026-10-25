'use client';

import type { Presence } from '@rotationlab/shared';
import { create } from 'zustand';

export interface Cursor {
  userId: string;
  boardId: string;
  x: number;
  y: number;
  /** ms timestamp of the last move (cursors fade after 5 s idle) */
  at: number;
}

interface PresenceState {
  roomId: string | null;
  /** online users by id: colour, board, idle (RT-3) */
  users: Record<string, Presence>;
  cursors: Record<string, Cursor>;
  setUsers: (roomId: string, users: Presence[]) => void;
  moveCursor: (c: Omit<Cursor, 'at'>) => void;
  dropCursor: (userId: string) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  roomId: null,
  users: {},
  cursors: {},
  setUsers: (roomId, users) => {
    set((s) => {
      const online = Object.fromEntries(users.map((u) => [u.userId, u]));
      // drop cursors of users who went offline
      const cursors = Object.fromEntries(Object.entries(s.cursors).filter(([id]) => id in online));
      return { roomId, users: online, cursors };
    });
  },
  moveCursor: (c) => {
    set((s) => ({ cursors: { ...s.cursors, [c.userId]: { ...c, at: Date.now() } } }));
  },
  dropCursor: (userId) => {
    set((s) => {
      const { [userId]: _gone, ...rest } = s.cursors;
      return { cursors: rest };
    });
  },
  clear: () => {
    set({ roomId: null, users: {}, cursors: {} });
  },
}));
