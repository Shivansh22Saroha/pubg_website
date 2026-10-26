'use client';

import type { Presence, Pt, Style } from '@rotationlab/shared';
import { create } from 'zustand';

export interface Cursor {
  userId: string;
  boardId: string;
  x: number;
  y: number;
  /** ms timestamp of the last move (cursors fade after 5 s idle) */
  at: number;
}

/** Another user's in-progress drawing (`stroke:preview`), one per user. */
export interface Ghost {
  userId: string;
  tempId: string;
  points: Pt[];
  style: Style;
  /** ms timestamp of the last update (ghosts expire after 3 s) */
  at: number;
}

export const GHOST_TTL_MS = 3_000;
/** a runaway ghost never grows past a full pen stroke */
const GHOST_MAX_POINTS = 2_000;

interface PresenceState {
  roomId: string | null;
  /** online users by id: colour, board, idle (RT-3) */
  users: Record<string, Presence>;
  cursors: Record<string, Cursor>;
  ghosts: Record<string, Ghost>;
  /** same tempId → append the new points; a new tempId replaces the user's ghost */
  previewGhost: (g: Omit<Ghost, 'at'>) => void;
  dropGhost: (userId: string) => void;
  /** drop ghosts without an update for 3 s */
  pruneGhosts: (now?: number) => void;
  setUsers: (roomId: string, users: Presence[]) => void;
  moveCursor: (c: Omit<Cursor, 'at'>) => void;
  dropCursor: (userId: string) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  roomId: null,
  users: {},
  cursors: {},
  ghosts: {},
  previewGhost: (g) => {
    set((s) => {
      const prev = s.ghosts[g.userId];
      const points =
        prev && prev.tempId === g.tempId
          ? [...prev.points, ...g.points].slice(-GHOST_MAX_POINTS)
          : g.points;
      return { ghosts: { ...s.ghosts, [g.userId]: { ...g, points, at: Date.now() } } };
    });
  },
  dropGhost: (userId) => {
    set((s) => {
      if (!(userId in s.ghosts)) return s;
      const { [userId]: _gone, ...rest } = s.ghosts;
      return { ghosts: rest };
    });
  },
  pruneGhosts: (now = Date.now()) => {
    set((s) => {
      const live = Object.entries(s.ghosts).filter(([, g]) => now - g.at <= GHOST_TTL_MS);
      return live.length === Object.keys(s.ghosts).length
        ? s
        : { ghosts: Object.fromEntries(live) };
    });
  },
  setUsers: (roomId, users) => {
    set((s) => {
      const online = Object.fromEntries(users.map((u) => [u.userId, u]));
      // drop cursors and ghosts of users who went offline
      const keep = <T>(r: Record<string, T>) =>
        Object.fromEntries(Object.entries(r).filter(([id]) => id in online));
      return { roomId, users: online, cursors: keep(s.cursors), ghosts: keep(s.ghosts) };
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
    set({ roomId: null, users: {}, cursors: {}, ghosts: {} });
  },
}));
