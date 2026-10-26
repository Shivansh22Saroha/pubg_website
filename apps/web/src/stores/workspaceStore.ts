'use client';

import type { PingInput } from '@rotationlab/shared';
import { create } from 'zustand';

export type PanelTab = 'chat' | 'layers' | 'members';

interface WorkspaceState {
  panelOpen: boolean;
  tab: PanelTab;
  /** 📍 pressed: the next map click attaches a ping (crosshair, Esc cancels) */
  pingPick: boolean;
  /** the ping chip in the chat input */
  draftPing: PingInput | null;
  /** bumped to focus the chat input */
  chatFocus: number;
  /** someone (ping chip, follow) wants another board shown */
  boardRequest: { boardId: string; n: number } | null;
  /** fly to a point on a board and pulse (ping chip) */
  focusRequest: { boardId: string; x: number; y: number; n: number } | null;
  /** how many sockets follow me (`followers:update`); I send view updates only while > 0 */
  followerCount: number;
  setPanelOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  setTab: (tab: PanelTab) => void;
  setPingPick: (on: boolean) => void;
  /** a picked / Alt+clicked point becomes the input's chip; the chat opens with focus */
  attachPing: (ping: PingInput) => void;
  clearPing: () => void;
  focusChat: () => void;
  requestBoard: (boardId: string) => void;
  requestFocus: (target: { boardId: string; x: number; y: number }) => void;
  setFollowerCount: (n: number) => void;
}

/** UI state of the room screen shared by the panel, the map overlays and the top bar. */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  panelOpen: true,
  tab: 'chat',
  pingPick: false,
  draftPing: null,
  chatFocus: 0,
  boardRequest: null,
  focusRequest: null,
  followerCount: 0,
  setPanelOpen: (open) => {
    set((s) => ({ panelOpen: typeof open === 'function' ? open(s.panelOpen) : open }));
  },
  setTab: (tab) => {
    set({ tab });
  },
  setPingPick: (pingPick) => {
    set({ pingPick });
  },
  attachPing: (draftPing) => {
    set((s) => ({
      draftPing,
      pingPick: false,
      panelOpen: true,
      tab: 'chat',
      chatFocus: s.chatFocus + 1,
    }));
  },
  clearPing: () => {
    set({ draftPing: null });
  },
  focusChat: () => {
    set((s) => ({ panelOpen: true, tab: 'chat', chatFocus: s.chatFocus + 1 }));
  },
  requestBoard: (boardId) => {
    set((s) => ({ boardRequest: { boardId, n: (s.boardRequest?.n ?? 0) + 1 } }));
  },
  requestFocus: (t) => {
    set((s) => ({
      focusRequest: { ...t, n: (s.focusRequest?.n ?? 0) + 1 },
      boardRequest: { boardId: t.boardId, n: (s.boardRequest?.n ?? 0) + 1 },
    }));
  },
  setFollowerCount: (followerCount) => {
    set({ followerCount });
  },
}));

/** The chat is on screen: the panel is open on the Chat tab. */
export const selectChatVisible = (s: WorkspaceState) => s.panelOpen && s.tab === 'chat';
