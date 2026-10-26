'use client';

import { create } from 'zustand';
import {
  idleFollow,
  reduceFollow,
  type FollowAction,
  type FollowEffect,
  type FollowState,
} from './followModel';

/** The leader's latest view, applied when the follower's map for that board is ready. */
export interface LeaderView {
  boardId: string;
  center: [number, number];
  zoom: number;
}

interface FollowDeps {
  meId: string;
  nameOf: (userId: string) => string;
  run: (e: FollowEffect) => void;
}

interface FollowStore extends FollowState {
  view: LeaderView | null;
  deps: FollowDeps | null;
  bind: (deps: FollowDeps | null) => void;
  dispatch: (a: FollowAction) => void;
  setView: (v: LeaderView) => void;
}

/** Follow mode (FEATURES F8): `reduceFollow` decides, the bound deps run the effects. */
export const useFollowStore = create<FollowStore>((set, get) => ({
  ...idleFollow,
  view: null,
  deps: null,
  bind: (deps) => {
    set({ deps });
  },
  dispatch: (a) => {
    const { deps } = get();
    if (!deps) return;
    const { state, effects } = reduceFollow(get(), a, deps);
    set({ ...state, ...(state.leaderId ? {} : { view: null }) });
    for (const e of effects) deps.run(e);
  },
  setView: (view) => {
    set({ view });
  },
}));
