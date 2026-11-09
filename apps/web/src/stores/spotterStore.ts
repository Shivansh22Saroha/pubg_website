'use client';

import { create } from 'zustand';

/** Spotter (the built-in help bot) is one panel for the whole app; any button can open it. */
interface SpotterState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSpotter = create<SpotterState>((set) => ({
  open: false,
  setOpen: (open) => {
    set({ open });
  },
}));
