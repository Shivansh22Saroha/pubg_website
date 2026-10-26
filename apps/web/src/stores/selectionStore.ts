'use client';

import type { BBox } from '@rotationlab/shared';
import { create } from 'zustand';

/** A move / resize being dragged: shown locally, committed once on release. */
export type Transform =
  | { kind: 'move'; ids: string[]; dx: number; dy: number }
  | { kind: 'radius'; id: string; r: number };

interface SelectionState {
  /** selected element ids (local; other users' selections aren't shown in v1) */
  ids: string[];
  transform: Transform | null;
  /** Shift+drag marquee, world units */
  marquee: BBox | null;
  /** elements the eraser will delete on release */
  highlight: string[];
  /** layers hidden in this tab only (Alt+click on the eye, FEATURES F5) */
  hiddenLayers: Record<string, true>;
  select: (ids: string[]) => void;
  clear: () => void;
  setTransform: (t: Transform | null) => void;
  setMarquee: (b: BBox | null) => void;
  setHighlight: (ids: string[]) => void;
  toggleHidden: (layerId: string) => void;
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export const useSelectionStore = create<SelectionState>((set, get) => ({
  ids: [],
  transform: null,
  marquee: null,
  highlight: [],
  hiddenLayers: {},
  select: (ids) => {
    const unique = [...new Set(ids)];
    if (!same(unique, get().ids)) set({ ids: unique });
  },
  clear: () => {
    if (get().ids.length > 0 || get().transform) set({ ids: [], transform: null });
  },
  setTransform: (transform) => {
    set({ transform });
  },
  setMarquee: (marquee) => {
    set({ marquee });
  },
  setHighlight: (highlight) => {
    if (!same(highlight, get().highlight)) set({ highlight });
  },
  toggleHidden: (layerId) => {
    set((s) => {
      const hiddenLayers = { ...s.hiddenLayers };
      if (hiddenLayers[layerId]) Reflect.deleteProperty(hiddenLayers, layerId);
      else hiddenLayers[layerId] = true;
      return { hiddenLayers };
    });
  },
}));
