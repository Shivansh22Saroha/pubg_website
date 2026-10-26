'use client';

import { create } from 'zustand';

/** Laser trails (FEATURES F6, Laser K): never persisted; each point lives 1.5 s. */
export const LASER_LIFETIME_MS = 1_500;
/** a runaway sender can't grow a trail without bound */
const MAX_POINTS = 120;

export interface LaserPoint {
  x: number;
  y: number;
  /** ms timestamp when it arrived */
  t: number;
}

export type Trails = Record<string, LaserPoint[]>;

/** Drops points older than the lifetime, and users with nothing left. Pure. */
export function pruneTrails(trails: Trails, now: number): Trails {
  const out: Trails = {};
  for (const [userId, points] of Object.entries(trails)) {
    const live = points.filter((p) => now - p.t <= LASER_LIFETIME_MS);
    if (live.length > 0) out[userId] = live;
  }
  return out;
}

/** 1 → 0 over the lifetime (the trail fades out). */
export function laserAlpha(p: LaserPoint, now: number): number {
  return Math.max(0, 1 - (now - p.t) / LASER_LIFETIME_MS);
}

interface LaserState {
  trails: Trails;
  add: (userId: string, x: number, y: number, t?: number) => void;
  prune: (now?: number) => void;
  clear: () => void;
}

export const useLaserStore = create<LaserState>((set) => ({
  trails: {},
  add: (userId, x, y, t = Date.now()) => {
    set((s) => ({
      trails: {
        ...s.trails,
        [userId]: [...(s.trails[userId] ?? []), { x, y, t }].slice(-MAX_POINTS),
      },
    }));
  },
  prune: (now = Date.now()) => {
    set((s) => {
      const next = pruneTrails(s.trails, now);
      return Object.keys(next).length === Object.keys(s.trails).length &&
        Object.entries(next).every(([k, v]) => v.length === s.trails[k]?.length)
        ? s
        : { trails: next };
    });
  },
  clear: () => {
    set({ trails: {} });
  },
}));
