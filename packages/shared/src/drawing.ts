/** Drawing defaults shared by the tools and anything that renders them (UI_UX_SPEC §2.2, F7). */
import type { MARKER_KINDS } from './schemas/elements.js';

/** The 10 palette swatches, in order (UI_UX_SPEC §2.2). */
export const DRAWING_PALETTE = [
  '#F2A900',
  '#EF4444',
  '#F97316',
  '#FACC15',
  '#22C55E',
  '#14B8A6',
  '#38BDF8',
  '#6366F1',
  '#EC4899',
  '#F8FAFC',
] as const;

export type MarkerKind = (typeof MARKER_KINDS)[number];

/** Default colour per marker kind (FEATURES F7); `null` = the active layer's colour. */
export const MARKER_DEFAULT_COLORS: Record<MarkerKind, string | null> = {
  own_squad: '#38BDF8',
  own_player: '#38BDF8',
  enemy_squad: '#EF4444',
  vehicle: '#FACC15',
  drop: '#F2A900',
  danger: '#F97316',
  hold: '#22C55E',
  pin: null,
};

export const STROKE_WIDTHS = [2, 4, 7] as const;
export type StrokeWidth = (typeof STROKE_WIDTHS)[number];

/** Fill opacity slider range for closed shapes (0–60 %). */
export const MAX_FILL_OPACITY = 0.6;
