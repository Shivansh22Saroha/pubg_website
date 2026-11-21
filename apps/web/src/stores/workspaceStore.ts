'use client';

import type { PingInput } from '@rotationlab/shared';
import { create } from 'zustand';

/**
 * Right panel / sheet tabs. On desktop (glass layout, 2026-11-21) routes + layers live in the
 * left panel, so the right panel shows chat · members · replay; touch sheets show them all.
 */
export type PanelTab = 'chat' | 'layers' | 'members' | 'plan' | 'replay';

/** px the floating room chrome covers on each side of the map (map overlays stay clear of it) */
export interface ChromeInsets {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface WorkspaceState {
  panelOpen: boolean;
  /** desktop glass layout: the left panel (route options + layers), toggled with [ */
  leftOpen: boolean;
  setLeftOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  /** "Full map" (H): the floating panels slide away for a clear view of the map */
  fullMap: boolean;
  setFullMap: (on: boolean | ((on: boolean) => boolean)) => void;
  chrome: ChromeInsets;
  setChrome: (c: ChromeInsets) => void;
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
  /** set by "Export view / whole map as PNG": the map's ExportController renders it */
  exportRequest: { area: ExportArea; n: number } | null;
  requestExport: (area: ExportArea) => void;
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

/** what a PNG export covers (FEATURES F12) */
export type ExportArea = 'view' | 'map';

/** UI state of the room screen shared by the panel, the map overlays and the top bar. */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  panelOpen: true,
  leftOpen: true,
  setLeftOpen: (open) => {
    set((s) => ({ leftOpen: typeof open === 'function' ? open(s.leftOpen) : open }));
  },
  fullMap: false,
  setFullMap: (on) => {
    set((s) => ({ fullMap: typeof on === 'function' ? on(s.fullMap) : on }));
  },
  chrome: { top: 0, left: 0, right: 0, bottom: 0 },
  setChrome: (c) => {
    set((s) =>
      s.chrome.top === c.top &&
      s.chrome.left === c.left &&
      s.chrome.right === c.right &&
      s.chrome.bottom === c.bottom
        ? s
        : { chrome: c },
    );
  },
  tab: 'chat',
  pingPick: false,
  draftPing: null,
  chatFocus: 0,
  boardRequest: null,
  focusRequest: null,
  followerCount: 0,
  exportRequest: null,
  requestExport: (area) => {
    set((s) => ({ exportRequest: { area, n: (s.exportRequest?.n ?? 0) + 1 } }));
  },
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
