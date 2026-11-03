import { create } from 'zustand';
import { typingPruned, typingSeen, typingStopped, type TypingMap } from './typingModel';

interface TypingState {
  typing: TypingMap;
  seen: (userId: string, now?: number) => void;
  stopped: (userId: string) => void;
  prune: (now?: number) => void;
  reset: () => void;
}

/** Who else is typing in the open room's chat (Phase 11). */
export const useTypingStore = create<TypingState>()((set) => ({
  typing: {},
  seen: (userId, now = Date.now()) => {
    set((s) => ({ typing: typingSeen(s.typing, userId, now) }));
  },
  stopped: (userId) => {
    set((s) => ({ typing: typingStopped(s.typing, userId) }));
  },
  prune: (now = Date.now()) => {
    set((s) => {
      const typing = typingPruned(s.typing, now);
      return typing === s.typing ? s : { typing };
    });
  },
  reset: () => {
    set({ typing: {} });
  },
}));
