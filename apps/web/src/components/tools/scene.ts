/**
 * Hit-testing and selection geometry for the Select and Eraser tools (FEATURES F5/F6). Pure:
 * everything works on world units with the shared geometry helpers; screen sizes (hit
 * tolerance, marker icons, text pills) come in through `worldPerPx`.
 */
import {
  anchorBBox,
  bboxContainsPoint,
  bboxIntersects,
  clampTranslation,
  distance,
  ELEMENT_LIMITS,
  elementBBox,
  expandBBox,
  hitTest,
  sweepPoints,
  translateGeometry,
  unionBBox,
  type AnyGeometry,
  type BBox,
  type Layer,
  type Pt,
} from '@rotationlab/shared';
import { toInput } from '@/lib/editing';
import type { Change, ViewElement } from '@/stores/boardModel';
import type { Transform } from '@/stores/selectionStore';

export interface Scene {
  elements: Readonly<Record<string, ViewElement>>;
  layers: readonly Layer[];
  /** layers hidden in this tab only */
  hidden: Readonly<Record<string, true>>;
  /** world units per screen pixel at the current zoom */
  worldPerPx: number;
  /** zoom scale of text labels (UI_UX_SPEC §6) */
  textScale: number;
}

/** Minimum hit distance around a path, in screen pixels. */
export const HIT_PX = 6;
/** Markers are 28 px icons centred on their anchor (UI_UX_SPEC §6.4). */
export const MARKER_HALF_PX = 14;
/** Grab radius of the circle's radius handle. */
export const HANDLE_PX = 8;
/** Ctrl/Cmd+D offset (world units = 20 m). */
export const DUPLICATE_OFFSET = 2_000;

const TEXT_PX = { sm: 12, md: 14, lg: 18 } as const;

const geometry = (el: ViewElement) => el.geometry as AnyGeometry;
export const isPointElement = (el: ViewElement) => el.type === 'TEXT' || el.type === 'MARKER';

/** Element boxes are cached per geometry object (the store keeps unchanged ones identical). */
const boxes = new WeakMap<object, BBox | null>();
function bboxOf(el: ViewElement): BBox | null {
  const g = el.geometry;
  if (!boxes.has(g)) boxes.set(g, elementBBox(geometry(el)));
  return boxes.get(g) ?? null;
}

/** On-screen box of a marker or text label, in world units (they don't scale with zoom). */
export function screenBox(el: ViewElement, scene: Scene): BBox | null {
  const at = geometry(el).at;
  if (!at) return null;
  const k = scene.worldPerPx;
  let halfW = MARKER_HALF_PX;
  let halfH = MARKER_HALF_PX;
  if (el.type === 'TEXT') {
    const props = el.props as { text?: unknown; size?: unknown };
    const size = props.size === 'sm' || props.size === 'lg' ? TEXT_PX[props.size] : TEXT_PX.md;
    const chars = typeof props.text === 'string' ? Array.from(props.text).length : 0;
    // matches the .rl-text pill: 8 px side padding, line-height 1.4, 2 px vertical padding
    halfW = ((chars * size * 0.55 + 16) * scene.textScale) / 2;
    halfH = ((size * 1.4 + 4) * scene.textScale) / 2;
  }
  return {
    minX: at[0] - halfW * k,
    minY: at[1] - halfH * k,
    maxX: at[0] + halfW * k,
    maxY: at[1] + halfH * k,
  };
}

/** The box a selection outline / marquee uses: on-screen for markers and text. */
export function displayBox(el: ViewElement, scene: Scene): BBox | null {
  return isPointElement(el) ? screenBox(el, scene) : bboxOf(el);
}

/** Does `p` hit the element on screen? */
export function hits(el: ViewElement, p: Pt, scene: Scene): boolean {
  if (isPointElement(el)) {
    const b = screenBox(el, scene);
    return b !== null && bboxContainsPoint(b, p);
  }
  const tol = Math.max(HIT_PX, el.style.width / 2 + 4) * scene.worldPerPx;
  const box = bboxOf(el);
  if (!box || !bboxContainsPoint(expandBBox(box, tol), p)) return false;
  return hitTest(
    { type: el.type, geometry: geometry(el), style: el.style, props: el.props },
    p,
    tol,
  );
}

/** Layers whose elements are on screen (board-visible and not hidden locally): id → layer. */
function shownLayers(scene: Scene): Map<string, Layer> {
  return new Map(
    scene.layers.filter((l) => l.visible && !scene.hidden[l.id]).map((l) => [l.id, l]),
  );
}

/** Select / eraser only touch shown, unlocked layers (FEATURES F5). */
export function editableLayerIds(scene: Scene): Set<string> {
  return new Set([...shownLayers(scene).values()].filter((l) => !l.locked).map((l) => l.id));
}

export function isEditable(scene: Scene, id: string): boolean {
  const el = scene.elements[id];
  return el !== undefined && editableLayerIds(scene).has(el.layerId);
}

/**
 * Topmost first, as drawn: layer position, then z, then markers / text (DOM icons sit above
 * the vector canvas), then id — the renderer's order, reversed.
 */
function topFirst(layers: Map<string, Layer>) {
  return (a: ViewElement, b: ViewElement) =>
    (layers.get(b.layerId)?.position ?? 0) - (layers.get(a.layerId)?.position ?? 0) ||
    b.z - a.z ||
    Number(isPointElement(b)) - Number(isPointElement(a)) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

function candidates(scene: Scene, layers: Map<string, Layer>): ViewElement[] {
  return Object.values(scene.elements).filter((el) => layers.has(el.layerId));
}

/** The topmost element under `p` on an editable layer. */
export function pickTop(scene: Scene, p: Pt): ViewElement | undefined {
  const shown = shownLayers(scene);
  const editable = new Map([...shown].filter(([, l]) => !l.locked));
  return candidates(scene, editable)
    .filter((el) => hits(el, p, scene))
    .sort(topFirst(shown))[0];
}

/** Every editable element under `p`, topmost first. */
export function pickAll(scene: Scene, p: Pt): string[] {
  const shown = shownLayers(scene);
  const editable = new Map([...shown].filter(([, l]) => !l.locked));
  return candidates(scene, editable)
    .filter((el) => hits(el, p, scene))
    .sort(topFirst(shown))
    .map((el) => el.id);
}

/** Everything an eraser sweep from `a` to `b` touches (sampled ≤ HIT_PX apart on screen). */
export function pickAlong(scene: Scene, a: Pt, b: Pt): string[] {
  const out = new Set<string>();
  for (const p of sweepPoints(a, b, HIT_PX * scene.worldPerPx))
    for (const id of pickAll(scene, p)) out.add(id);
  return [...out];
}

/** Marquee: editable elements whose bounding box intersects `box`. */
export function pickInBox(scene: Scene, box: BBox): string[] {
  const editable = editableLayerIds(scene);
  return Object.values(scene.elements)
    .filter((el) => editable.has(el.layerId))
    .filter((el) => {
      const b = displayBox(el, scene);
      return b !== null && bboxIntersects(b, box);
    })
    .map((el) => el.id);
}

/** Something shown but locked is under `p`: its layer (to explain why nothing happened). */
export function lockedLayerAt(scene: Scene, p: Pt): Layer | undefined {
  const shown = shownLayers(scene);
  const locked = new Map([...shown].filter(([, l]) => l.locked));
  const el = candidates(scene, locked)
    .filter((e) => hits(e, p, scene))
    .sort(topFirst(shown))[0];
  return el ? locked.get(el.layerId) : undefined;
}

/** Ctrl/Cmd+A: every editable element on one layer. */
export function idsOnLayer(scene: Scene, layerId: string): string[] {
  if (!editableLayerIds(scene).has(layerId)) return [];
  return Object.values(scene.elements)
    .filter((el) => el.layerId === layerId)
    .map((el) => el.id);
}

// ---- circle radius handle ------------------------------------------------------------------

/** The radius handle sits on the circle's east edge. */
export function radiusHandle(el: ViewElement): Pt | null {
  const g = geometry(el);
  if (el.type !== 'CIRCLE' || !g.center) return null;
  return [g.center[0] + (g.r ?? 0), g.center[1]];
}

/** A selected, editable circle whose radius handle is under `p`. */
export function pickRadiusHandle(
  scene: Scene,
  selection: readonly string[],
  p: Pt,
): ViewElement | undefined {
  const editable = editableLayerIds(scene);
  for (const id of selection) {
    const el = scene.elements[id];
    const h = el && editable.has(el.layerId) ? radiusHandle(el) : null;
    if (el && h && distance(h, p) <= HANDLE_PX * scene.worldPerPx) return el;
  }
  return undefined;
}

export function clampRadius(r: number): number {
  return Math.max(
    ELEMENT_LIMITS.circleRadiusMin,
    Math.min(ELEMENT_LIMITS.circleRadiusMax, Math.round(r)),
  );
}

// ---- transforms ----------------------------------------------------------------------------

/** Box of the stored coordinates of `ids` (what must stay inside the map when moving). */
export function anchorBoxOf(
  elements: Readonly<Record<string, ViewElement>>,
  ids: readonly string[],
) {
  return unionBBox(ids.map((id) => (elements[id] ? anchorBBox(geometry(elements[id])) : null)));
}

/** A drag delta, shrunk so the whole selection stays on the map. */
export function clampMove(
  elements: Readonly<Record<string, ViewElement>>,
  ids: readonly string[],
  dx: number,
  dy: number,
  worldSize: number,
): [number, number] {
  const box = anchorBoxOf(elements, ids);
  return box ? clampTranslation(box, dx, dy, worldSize) : [0, 0];
}

function transformed(el: ViewElement, t: Transform): ViewElement {
  if (t.kind === 'move') {
    return {
      ...el,
      geometry: translateGeometry(geometry(el), t.dx, t.dy) as ViewElement['geometry'],
    };
  }
  return { ...el, geometry: { ...el.geometry, r: t.r } };
}

/** The view with an in-progress drag applied; untouched elements keep their identity. */
export function withTransform(
  elements: Readonly<Record<string, ViewElement>>,
  t: Transform | null,
): Readonly<Record<string, ViewElement>> {
  if (!t) return elements;
  const ids = t.kind === 'move' ? t.ids : [t.id];
  const out = { ...elements };
  for (const id of ids) {
    const el = elements[id];
    if (el) out[id] = transformed(el, t);
  }
  return out;
}

/** The changes a finished drag commits (one undo step). */
export function transformChanges(
  elements: Readonly<Record<string, ViewElement>>,
  t: Transform,
): Change[] {
  const ids = t.kind === 'move' ? t.ids : [t.id];
  if (t.kind === 'move' && t.dx === 0 && t.dy === 0) return [];
  return ids.flatMap((id) => {
    const el = elements[id];
    if (!el) return [];
    return [{ id, before: toInput(el), after: toInput(transformed(el, t)) }];
  });
}

/** Ctrl/Cmd+D: copies with new ids, offset by 20 m (clamped as a group to the map). */
export function duplicateChanges(
  elements: Readonly<Record<string, ViewElement>>,
  ids: readonly string[],
  worldSize: number,
  newId: () => string,
): Change[] {
  const [dx, dy] = clampMove(elements, ids, DUPLICATE_OFFSET, DUPLICATE_OFFSET, worldSize);
  return ids.flatMap((id) => {
    const el = elements[id];
    if (!el) return [];
    const copy = toInput(transformed(el, { kind: 'move', ids: [id], dx, dy }));
    const fresh = newId();
    return [{ id: fresh, before: null, after: { ...copy, id: fresh } }];
  });
}

/** Delete / eraser: removing each element is one change of a single step. */
export function deleteChanges(
  elements: Readonly<Record<string, ViewElement>>,
  ids: readonly string[],
): Change[] {
  return ids.flatMap((id) => {
    const el = elements[id];
    return el ? [{ id, before: toInput(el), after: null }] : [];
  });
}

/** Style bar / move-to-layer edits on the selection: `patch` maps each input to its new state. */
export function editChanges(
  elements: Readonly<Record<string, ViewElement>>,
  ids: readonly string[],
  patch: (input: ReturnType<typeof toInput>) => ReturnType<typeof toInput>,
): Change[] {
  return ids.flatMap((id) => {
    const el = elements[id];
    if (!el) return [];
    const before = toInput(el);
    return [{ id, before, after: patch(before) }];
  });
}
