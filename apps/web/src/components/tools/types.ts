import type { BBox, ElementInput, Layer, MarkerKind, Pt, Style } from '@rotationlab/shared';
import type { Change } from '@/stores/boardModel';
import type { MeasureLine } from '@/stores/measureStore';
import type { Transform } from '@/stores/selectionStore';
import type { Scene } from './scene';

export type ToolId =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'circle'
  | 'polygon'
  | 'text'
  | 'marker'
  | 'eraser'
  | 'measure'
  | 'laser';

/** The tools that create elements (style bar, permission gating, `canCreate`). */
export const CREATION_TOOLS = [
  'pen',
  'line',
  'arrow',
  'circle',
  'polygon',
  'text',
  'marker',
] as const satisfies readonly ToolId[];
export type CreationToolId = (typeof CREATION_TOOLS)[number];

/** Every tool in the toolbar is built (Phase 8 added Measure). */
export const IMPLEMENTED_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'select',
  ...CREATION_TOOLS,
  'eraser',
  'measure',
  'laser',
]);

export function isCreationTool(id: ToolId): id is CreationToolId {
  return (CREATION_TOOLS as readonly ToolId[]).includes(id);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a tool commits; the controller adds id, boardId, layerId and z. */
export type NewElement = DistributiveOmit<ElementInput, 'id' | 'boardId' | 'layerId' | 'z'>;

/** A pointer sample, already in integer world units clamped to the map. */
export interface ToolPointer {
  world: Pt;
  /** client pixels (a Leaflet pan keeps `world` fixed under the pointer, `screen` doesn't) */
  screen: Pt;
  shiftKey: boolean;
  /** 0 = primary */
  button: number;
}

export interface ToolKey {
  key: string;
  shiftKey: boolean;
}

/** The local, dashed preview of what is being drawn. */
export type Draft =
  | { kind: 'path'; points: Pt[]; closed: boolean; arrow: boolean; style: Style }
  | { kind: 'circle'; center: Pt; r: number; style: Style; label: string };

/** `stroke:preview` for others (throttled by the sender). */
export interface PreviewSink {
  /** start a new ghost (new tempId) whose points are appended */
  begin(): void;
  /** only the new points since the last call */
  append(points: Pt[]): void;
  /** non-append-only shapes (line, circle): each flush is a whole new ghost */
  replace(points: Pt[]): void;
  end(): void;
}

export interface ToolContext {
  readonly worldSize: number;
  /** world units per screen pixel at the current zoom */
  worldPerPx(): number;
  /** the style bar's current style for this tool */
  style(): Style;
  /** permission / lock / cap gating; false = blocked (the context shows why) */
  canCreate(): boolean;
  /** optimistic create through the board store; false when it was refused */
  commit(el: NewElement): boolean;
  setDraft(d: Draft | null): void;
  preview: PreviewSink;
  /** text tool: show / hide the inline editor at a world point */
  openText(at: Pt): void;
  closeText(): void;
  textSize(): 'sm' | 'md' | 'lg';
  /** marker tool: kind, number (auto) and label for the next placement */
  markerProps(): { kind: MarkerKind; number?: number; label?: string };
  /** circle tool: a zone preset radius (world units) armed in the style bar, or null */
  presetRadius(): number | null;

  // ---- select & eraser (Phase 6B) --------------------------------------------------------
  /** elements, layers and zoom for hit-testing */
  scene(): Scene;
  /** may this user edit elements at all (role, queue); false = blocked and explained */
  canEdit(): boolean;
  selection(): readonly string[];
  select(ids: string[]): void;
  /** live, local preview of a move / radius drag (null = none) */
  setTransform(t: Transform | null): void;
  setMarquee(box: BBox | null): void;
  /** eraser: elements that will be deleted */
  setHighlight(ids: string[]): void;
  /** one user action → one batch → one undo step */
  commitChanges(changes: Change[]): boolean;
  /** double-click: edit a text's text or a marker's label in place */
  editInline(id: string): void;
  /** the pointer hit something on a locked layer: say why nothing happens */
  explainLocked(layer: Layer): void;
  /** laser tool: one point of the trail (ephemeral, every role) */
  laser(at: Pt): void;
  /** measure tool: the local line (null clears it) */
  setMeasure(line: MeasureLine | null): void;
}

export interface Tool {
  readonly id: ToolId;
  /** CSS cursor while this tool is active */
  readonly cursor: string;
  /** true while a draft is in progress */
  readonly busy: boolean;
  /**
   * A press: the tool owns it (no Leaflet drag, pointer captured until release). Only
   * `SelectTool.onPointerDown` can decline by returning false (empty map → Leaflet pans).
   */
  onPointerDown(p: ToolPointer): void;
  onPointerMove(p: ToolPointer): void;
  onPointerUp(p: ToolPointer): void;
  /** `SelectTool` returns true when it consumed it (Leaflet's double-click zoom must not run) */
  onDoubleClick(p: ToolPointer): void;
  /** true when the key was consumed */
  onKeyDown(k: ToolKey): boolean;
  /** drop any draft (Esc, tool switch, second touch, lost permission) */
  cancel(): void;
}
