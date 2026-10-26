'use client';

import type { ChatMessage, PingInput } from '@rotationlab/shared';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  addPending,
  dropPending,
  emptyChat,
  failPending,
  loadPage,
  markDeleted,
  receive,
  retryPending,
  type ChatState,
} from './chatModel';
import { useWorkspaceStore } from './workspaceStore';

interface ChatActions {
  reset: (roomId: string | null, meId: string) => void;
  pageLoaded: (page: { items: ChatMessage[]; nextCursor: string | null }, older: boolean) => void;
  receive: (m: ChatMessage) => void;
  deleted: (messageId: string) => void;
  addPending: (p: {
    clientId: string;
    body: string;
    ping: PingInput | null;
    createdAt: string;
  }) => void;
  acked: (m: ChatMessage) => void;
  failed: (clientId: string, error: string) => void;
  retry: (clientId: string) => void;
  drop: (clientId: string) => void;
  markRead: () => void;
}

/** Zustand + immer wrapper around the pure chat model (see chatModel.ts). */
export const useChatStore = create<ChatState & ChatActions>()(
  immer((set) => ({
    ...emptyChat(),
    reset: (roomId, meId) => {
      set(() => emptyChat(roomId, meId));
    },
    pageLoaded: (page, older) => {
      set((s) => {
        loadPage(s, page, older);
      });
    },
    receive: (m) => {
      const ws = useWorkspaceStore.getState();
      set((s) => {
        receive(s, m, ws.panelOpen && ws.tab === 'chat');
      });
    },
    deleted: (id) => {
      set((s) => {
        markDeleted(s, id);
      });
    },
    addPending: (p) => {
      set((s) => {
        addPending(s, p);
      });
    },
    acked: (m) => {
      set((s) => {
        receive(s, m, true);
      });
    },
    failed: (clientId, error) => {
      set((s) => {
        failPending(s, clientId, error);
      });
    },
    retry: (clientId) => {
      set((s) => {
        retryPending(s, clientId);
      });
    },
    drop: (clientId) => {
      set((s) => {
        dropPending(s, clientId);
      });
    },
    markRead: () => {
      set((s) => {
        s.unread = 0;
      });
    },
  })),
);
