'use client';

import type { Pt } from '@rotationlab/shared';
import { create } from 'zustand';

/** The measure tool's line (FEATURES F11) — local only, never sent or stored. */
export interface MeasureLine {
  points: Pt[];
  /** the rubber band to the pointer while measuring */
  hover: Pt | null;
  /** double-click / Enter ended it; it stays on screen until Esc or a new measure */
  finished: boolean;
}

export const useMeasureStore = create<{ line: MeasureLine | null }>(() => ({ line: null }));
