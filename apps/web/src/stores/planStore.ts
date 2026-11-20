'use client';

import { create } from 'zustand';

/**
 * Plan tools (FEATURES F24) — view state only, per tab, never sent anywhere:
 * - `focusRouteId`: the route picked in the Plan tab; the map dims every other element and the
 *   compass bar shows its bearing
 * - `replayStep`: plan replay; only the first N elements (creation order) are on the map.
 *   null = not replaying (everything shows)
 */
interface PlanState {
  focusRouteId: string | null;
  /** bumped to fit the map to the focused route */
  fitRequest: number;
  replayStep: number | null;
  playing: boolean;
  /** metres per world unit of the board on screen, published by the map (custom maps: F20) */
  metresPerUnit: number;
  focusRoute: (id: string | null, fit?: boolean) => void;
  setReplayStep: (step: number | null) => void;
  setPlaying: (on: boolean) => void;
  setMetresPerUnit: (mpu: number) => void;
  reset: () => void;
}

export const usePlanStore = create<PlanState>((set) => ({
  focusRouteId: null,
  fitRequest: 0,
  replayStep: null,
  playing: false,
  metresPerUnit: 0.01,
  focusRoute: (id, fit = false) => {
    set((s) => ({ focusRouteId: id, fitRequest: fit && id ? s.fitRequest + 1 : s.fitRequest }));
  },
  setReplayStep: (replayStep) => {
    set(replayStep === null ? { replayStep, playing: false } : { replayStep });
  },
  setPlaying: (playing) => {
    set({ playing });
  },
  setMetresPerUnit: (metresPerUnit) => {
    set((s) => (s.metresPerUnit === metresPerUnit ? s : { metresPerUnit }));
  },
  reset: () => {
    set({ focusRouteId: null, replayStep: null, playing: false });
  },
}));
