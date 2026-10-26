/**
 * Who may create what, where (FEATURES F5/F6, SECURITY §3). Client-side gating only mirrors
 * the server — the server re-checks every op — but it keeps people from drawing things that
 * would just be rolled back.
 */
import {
  can,
  ELEMENT_LIMITS,
  type Layer,
  type MarkerKind,
  type RoomRole,
} from '@rotationlab/shared';
import type { Breakpoint } from '@/hooks/useBreakpoint';
import type { ViewElement } from '@/stores/boardModel';
import type { ToolId } from './types';

/** FEATURES F6: warn from 4 500 elements, block at 5 000. */
export const ELEMENT_WARN_AT = 4_500;

export type CreateBlock = 'role' | 'no-layer' | 'locked' | 'board-full' | 'queue-full';

export const BLOCK_MESSAGES: Record<CreateBlock, (layer?: string) => string> = {
  role: () => 'Viewers can’t draw on this board',
  'no-layer': () => 'Pick a layer to draw on',
  locked: (name) => `Layer “${name ?? ''}” is locked`,
  'board-full': () => 'Board is full — duplicate to a new board or clean up',
  'queue-full': () => 'Too many unsynced changes — reconnect before drawing more',
};

/** The tools a role sees in the toolbar (UI_UX_SPEC §3.5: viewers get Select, Measure, Laser). */
export function toolsForRole(role: RoomRole): ToolId[] {
  return can(role, 'board.edit')
    ? [
        'select',
        'pen',
        'line',
        'arrow',
        'circle',
        'polygon',
        'text',
        'marker',
        'eraser',
        'measure',
        'laser',
      ]
    : ['select', 'measure', 'laser'];
}

/**
 * UI_UX_SPEC §7 phone "view + chat" mode: Select, Marker, Laser and Measure only (what the
 * role allows of them). Tablets and up get the role's full set.
 */
export const PHONE_TOOLS: readonly ToolId[] = ['select', 'marker', 'measure', 'laser'];

export function toolsFor(role: RoomRole, breakpoint: Breakpoint): ToolId[] {
  const tools = toolsForRole(role);
  return breakpoint === 'phone' ? tools.filter((t) => PHONE_TOOLS.includes(t)) : tools;
}

export interface CreateState {
  role: RoomRole;
  layer: Layer | undefined;
  elementCount: number;
  queueFull: boolean;
}

/** Why creating an element is blocked right now, or null when it is allowed. */
export function creationBlock(s: CreateState): CreateBlock | null {
  if (!can(s.role, 'board.edit')) return 'role';
  if (!s.layer) return 'no-layer';
  // the server refuses element ops on a locked layer for every role (API_SPEC §7.2) — the
  // owner unlocks it first
  if (s.layer.locked) return 'locked';
  if (s.elementCount >= ELEMENT_LIMITS.maxElementsPerBoard) return 'board-full';
  if (s.queueFull) return 'queue-full';
  return null;
}

/**
 * The layer new elements go to (FEATURES F5, per user, local): the user's pick while it still
 * exists, else the first unlocked layer, else the first layer (drawing is then blocked as
 * locked).
 */
export function resolveActiveLayer(
  layers: readonly Layer[],
  picked: string | null,
): Layer | undefined {
  const sorted = [...layers].sort((a, b) => a.position - b.position);
  return sorted.find((l) => l.id === picked) ?? sorted.find((l) => !l.locked) ?? sorted[0];
}

/**
 * Next marker number (FEATURES F7): enemy squads take the lowest unused 1–25 on the board;
 * own players the lowest unused 1–4, cycling 1→4 once all four exist. Other kinds: none.
 */
export function nextMarkerNumber(
  elements: Record<string, ViewElement>,
  kind: MarkerKind,
): number | undefined {
  const max =
    kind === 'enemy_squad' ? ELEMENT_LIMITS.markerNumberMax : kind === 'own_player' ? 4 : 0;
  if (max === 0) return undefined;
  const used = new Set<number>();
  let count = 0;
  for (const el of Object.values(elements)) {
    if (el.type !== 'MARKER') continue;
    const props = el.props as { kind?: string; number?: unknown };
    if (props.kind !== kind) continue;
    count++;
    if (typeof props.number === 'number') used.add(props.number);
  }
  for (let n = 1; n <= max; n++) if (!used.has(n)) return n;
  return kind === 'own_player' ? (count % 4) + 1 : undefined; // all 25 enemy numbers taken
}

/** "Team Soul" → "TS" (own-squad default label, FEATURES F7). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export interface LayerPermissions {
  /** board-wide eye toggle */
  toggleVisible: boolean;
  /** the lock toggle is a button for the owner only; everyone else sees a read-only icon */
  toggleLock: boolean;
  rename: boolean;
  recolor: boolean;
  delete: boolean;
  clear: boolean;
  reorder: boolean;
}

/**
 * What the layers panel offers (FEATURES F5, SECURITY §3): Editor+ edits unlocked layers;
 * lock / unlock and any edit of a locked layer is OWNER-only; a locked layer can't be cleared
 * by anyone (element ops are refused); the last layer can't be deleted. Local hide (Alt+click
 * the eye) is open to every role and not listed here.
 */
export function layerPermissions(
  role: RoomRole,
  layer: Pick<Layer, 'locked'>,
  layerCount: number,
): LayerPermissions {
  const edit = can(role, 'board.edit');
  const editThis = edit && (!layer.locked || can(role, 'layer.lock'));
  return {
    toggleVisible: editThis,
    toggleLock: can(role, 'layer.lock'),
    rename: editThis,
    recolor: editThis,
    delete: editThis && layerCount > 1,
    clear: edit && !layer.locked,
    reorder: edit,
  };
}
