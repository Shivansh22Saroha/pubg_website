'use client';

import { create } from 'zustand';

/**
 * Map pulses (UI_UX_SPEC §5): `ping` — a sent ping, 3 s, for everyone on that board;
 * `focus` — the 3-pulse ring after a ping chip's fly-to (1.2 s).
 */
export interface Pulse {
  id: number;
  boardId: string;
  x: number;
  y: number;
  kind: 'ping' | 'focus';
  until: number;
}

export const PULSE_MS = { ping: 3_000, focus: 1_200 } as const;

interface PulseState {
  pulses: Pulse[];
  add: (p: Omit<Pulse, 'id' | 'until'>, now?: number) => void;
  prune: (now?: number) => void;
}

let nextId = 1;

export const usePulseStore = create<PulseState>((set) => ({
  pulses: [],
  add: (p, now = Date.now()) => {
    set((s) => ({ pulses: [...s.pulses, { ...p, id: nextId++, until: now + PULSE_MS[p.kind] }] }));
  },
  prune: (now = Date.now()) => {
    set((s) => {
      const live = s.pulses.filter((p) => p.until > now);
      return live.length === s.pulses.length ? s : { pulses: live };
    });
  },
}));
