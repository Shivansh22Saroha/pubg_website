'use client';

import {
  MARKER_DEFAULT_COLORS,
  MARKER_KINDS,
  StyleSchema,
  type MarkerKind,
  type Style,
} from '@rotationlab/shared';
import { create } from 'zustand';
import type { Draft, ToolId } from '@/components/tools/types';
import { prefKeys, readPref, writePref } from '@/lib/prefs';

export type TextSize = 'sm' | 'md' | 'lg';

const BASE: Style = { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 };

/** Per-tool defaults (UI_UX_SPEC §6: circle fill 10 %, polygon 15 %). */
export function defaultStyle(tool: ToolId): Style {
  if (tool === 'circle') return { ...BASE, fillOpacity: 0.1 };
  if (tool === 'polygon') return { ...BASE, fillOpacity: 0.15 };
  if (tool === 'marker') return { ...BASE, color: MARKER_DEFAULT_COLORS.enemy_squad ?? BASE.color };
  if (tool === 'text') return { ...BASE, color: '#F8FAFC', width: 2 };
  return BASE;
}

function loadStyles(): Partial<Record<ToolId, Style>> {
  const raw = typeof window === 'undefined' ? null : readPref(prefKeys.toolStyles);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<ToolId, Style>> = {};
    for (const [tool, style] of Object.entries(parsed)) {
      const s = StyleSchema.safeParse(style);
      if (s.success) out[tool as ToolId] = s.data;
    }
    return out;
  } catch {
    return {};
  }
}

function loadMarkerKind(): MarkerKind {
  const raw = typeof window === 'undefined' ? null : readPref(prefKeys.markerKind);
  return (MARKER_KINDS as readonly string[]).includes(raw ?? '')
    ? (raw as MarkerKind)
    : 'enemy_squad';
}

interface ToolState {
  tool: ToolId;
  /** per user, local (FEATURES F5); null = default (first drawable layer) */
  activeLayerId: string | null;
  styles: Partial<Record<ToolId, Style>>;
  markerKind: MarkerKind;
  markerLabel: string;
  textSize: TextSize;
  /** arrow tool: new arrows get a head at both ends (Phase 11, remembered per device) */
  arrowDoubleHeaded: boolean;
  /** arrow tool: new arrows are curved through their bends (Phase 12, remembered per device) */
  arrowCurved: boolean;
  /** an armed zone preset radius (world units) for the circle tool */
  presetRadius: number | null;
  setTool: (tool: ToolId) => void;
  setActiveLayer: (id: string | null) => void;
  setStyle: (tool: ToolId, patch: Partial<Style>) => void;
  /** picking a kind resets the marker colour to that kind's default (pin → layer colour) */
  setMarkerKind: (kind: MarkerKind, layerColor: string) => void;
  setMarkerLabel: (label: string) => void;
  setTextSize: (size: TextSize) => void;
  setArrowDoubleHeaded: (on: boolean) => void;
  setArrowCurved: (on: boolean) => void;
  setPresetRadius: (r: number | null) => void;
}

/** Tool, style bar and active-layer state for this tab. Styles are remembered per tool. */
export const useToolStore = create<ToolState>((set, get) => ({
  tool: 'select',
  activeLayerId: null,
  styles: loadStyles(),
  markerKind: loadMarkerKind(),
  markerLabel: '',
  textSize: 'md',
  arrowDoubleHeaded: typeof window !== 'undefined' && readPref(prefKeys.arrowDoubleHeaded) === '1',
  arrowCurved: typeof window !== 'undefined' && readPref(prefKeys.arrowCurved) === '1',
  presetRadius: null,
  setTool: (tool) => {
    set({ tool, presetRadius: tool === 'circle' ? get().presetRadius : null });
  },
  setActiveLayer: (activeLayerId) => {
    set({ activeLayerId });
  },
  setStyle: (tool, patch) => {
    const styles = { ...get().styles, [tool]: { ...styleFor(get(), tool), ...patch } };
    set({ styles });
    writePref(prefKeys.toolStyles, JSON.stringify(styles));
  },
  setMarkerKind: (markerKind, layerColor) => {
    get().setStyle('marker', { color: MARKER_DEFAULT_COLORS[markerKind] ?? layerColor });
    set({ markerKind });
    writePref(prefKeys.markerKind, markerKind);
  },
  setMarkerLabel: (markerLabel) => {
    set({ markerLabel });
  },
  setTextSize: (textSize) => {
    set({ textSize });
  },
  setArrowDoubleHeaded: (arrowDoubleHeaded) => {
    set({ arrowDoubleHeaded });
    writePref(prefKeys.arrowDoubleHeaded, arrowDoubleHeaded ? '1' : '0');
  },
  setArrowCurved: (arrowCurved) => {
    set({ arrowCurved });
    writePref(prefKeys.arrowCurved, arrowCurved ? '1' : '0');
  },
  setPresetRadius: (presetRadius) => {
    set({ presetRadius });
  },
}));

export function styleFor(s: Pick<ToolState, 'styles'>, tool: ToolId): Style {
  return s.styles[tool] ?? defaultStyle(tool);
}

/** The local draft preview — outside React so pointer moves never re-render components. */
export const useDraftStore = create<{ draft: Draft | null }>(() => ({ draft: null }));
