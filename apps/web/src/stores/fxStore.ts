'use client';

import { create } from 'zustand';

/** One-shot visual cues the map plays in response to room events (motion library). */
interface FxState {
  /** bumped when a snapshot restore replaces the board — plays the rewind mark once */
  rewind: number;
  playRewind: () => void;
}

export const useFxStore = create<FxState>((set) => ({
  rewind: 0,
  playRewind: () => {
    set((s) => ({ rewind: s.rewind + 1 }));
  },
}));
