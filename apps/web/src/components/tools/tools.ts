/**
 * The drawing tools (FEATURES F6, UI_UX_SPEC §6). Each is a small state machine fed with
 * world-unit pointer samples; it shows a local draft, streams `stroke:preview` and commits a
 * `NewElement` through the context. No Leaflet or DOM here — ToolLayer does the plumbing.
 */
import {
  circleFromEdge,
  circleRadius,
  clampToWorld,
  ELEMENT_LIMITS,
  formatMetres,
  snapAngle,
  type Pt,
} from '@rotationlab/shared';
import simplify from 'simplify-js';
import { BaseTool } from './baseTool';
import { EraserTool, SelectTool } from './selectTools';
import type { ToolContext, ToolId, ToolKey, ToolPointer } from './types';

/** Pen samples a new point once the pointer moved this far on screen. */
export const PEN_SAMPLE_PX = 4;
/** Pen simplification tolerance, in screen pixels (converted at the current zoom). */
export const PEN_SIMPLIFY_PX = 1.5;
/** Press-drag beyond this many pixels makes a straight arrow instead of a click. */
export const DRAG_THRESHOLD_PX = 6;
/** Clicks closer than this to the previous vertex are the same vertex (double-click). */
export const SAME_POINT_PX = 3;
/** Clicking within this distance of the first polygon vertex closes it. */
export const CLOSE_POLYGON_PX = 8;
/** Vertices of the circle outline sent as a ghost. */
const GHOST_CIRCLE_SEGMENTS = 48;

// ---- Pen ---------------------------------------------------------------------------------

export class PenTool extends BaseTool {
  readonly id = 'pen';
  private points: Pt[] = [];
  private drawing = false;

  get busy() {
    return this.drawing;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0 || this.drawing || !this.ctx.canCreate()) return;
    this.drawing = true;
    this.points = [p.world];
    this.ctx.preview.begin();
    this.ctx.preview.append([p.world]);
    this.draft();
  }

  override onPointerMove(p: ToolPointer) {
    if (!this.drawing) return;
    const last = this.points.at(-1);
    if (last && this.px(last, p.world) < PEN_SAMPLE_PX) return;
    this.points.push(p.world);
    this.ctx.preview.append([p.world]);
    if (this.points.length >= ELEMENT_LIMITS.strokePoints) {
      // auto-commit and carry on as a new stroke from the same point
      this.commitStroke();
      this.points = [p.world];
      this.ctx.preview.begin();
      this.ctx.preview.append([p.world]);
    }
    this.draft();
  }

  override onPointerUp(p: ToolPointer) {
    if (!this.drawing) return;
    const last = this.points.at(-1);
    if (last && (last[0] !== p.world[0] || last[1] !== p.world[1])) this.points.push(p.world);
    this.commitStroke();
    this.drawing = false;
    this.points = [];
    this.reset();
  }

  override cancel() {
    this.drawing = false;
    this.points = [];
    this.reset();
  }

  private commitStroke() {
    const tolerance = PEN_SIMPLIFY_PX * this.ctx.worldPerPx();
    const simplified = simplify(
      this.points.map(([x, y]) => ({ x, y })),
      tolerance,
      true,
    ).map(({ x, y }): Pt => [Math.round(x), Math.round(y)]);
    const points = dedupe(simplified);
    if (points.length < 2) return; // a click without movement draws nothing
    this.ctx.commit({
      type: 'STROKE',
      geometry: { points: points.map(mutable) },
      style: this.ctx.style(),
      props: {},
    });
  }

  private draft() {
    this.ctx.setDraft({
      kind: 'path',
      points: [...this.points],
      closed: false,
      arrow: false,
      style: this.ctx.style(),
    });
  }
}

// ---- Line --------------------------------------------------------------------------------

export class LineTool extends BaseTool {
  readonly id = 'line';
  private start: Pt | null = null;
  private end: Pt | null = null;

  get busy() {
    return this.start !== null;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0 || this.start || !this.ctx.canCreate()) return;
    this.start = p.world;
    this.end = p.world;
  }

  override onPointerMove(p: ToolPointer) {
    if (!this.start) return;
    this.end = this.endPoint(p);
    const points = [this.start, this.end];
    this.ctx.setDraft({
      kind: 'path',
      points,
      closed: false,
      arrow: false,
      style: this.ctx.style(),
    });
    this.ctx.preview.replace(points);
  }

  override onPointerUp(p: ToolPointer) {
    const start = this.start;
    if (!start) return;
    const end = this.endPoint(p);
    this.start = null;
    this.end = null;
    this.reset();
    if (this.px(start, end) < SAME_POINT_PX) return;
    this.ctx.commit({
      type: 'LINE',
      geometry: { points: [mutable(start), mutable(end)] },
      style: this.ctx.style(),
      props: {},
    });
  }

  override cancel() {
    this.start = null;
    this.end = null;
    this.reset();
  }

  private endPoint(p: ToolPointer): Pt {
    if (!this.start || !p.shiftKey) return p.world;
    return clampToWorld(snapAngle(this.start, p.world), this.ctx.worldSize);
  }
}

// ---- Arrow & polygon (click to add vertices) ---------------------------------------------

abstract class VertexTool extends BaseTool {
  protected points: Pt[] = [];
  protected hover: Pt | null = null;
  protected pressed = false;
  /** the press that started the shape: its release must not add a second vertex */
  protected starting = false;

  get busy() {
    return this.points.length > 0;
  }

  protected abstract readonly maxPoints: number;
  protected abstract finish(): void;
  protected abstract draftShape(): void;

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0) return;
    if (this.points.length === 0) {
      if (!this.ctx.canCreate()) return;
      this.points = [p.world];
      this.starting = true;
      this.ctx.preview.begin();
      this.ctx.preview.append([p.world]);
      this.draftShape();
    }
    this.pressed = true;
  }

  override onPointerMove(p: ToolPointer) {
    if (this.points.length === 0) return;
    this.hover = this.snapped(p);
    this.draftShape();
  }

  override onPointerUp(p: ToolPointer) {
    if (!this.pressed) return;
    this.pressed = false;
    if (this.starting) {
      this.starting = false;
      return;
    }
    this.addVertex(this.snapped(p));
  }

  override onDoubleClick() {
    if (this.busy) this.finish();
  }

  override onKeyDown(k: ToolKey) {
    if (k.key === 'Enter' && this.busy) {
      this.finish();
      return true;
    }
    return super.onKeyDown(k);
  }

  override cancel() {
    this.points = [];
    this.hover = null;
    this.pressed = false;
    this.starting = false;
    this.reset();
  }

  protected addVertex(pt: Pt) {
    const last = this.points.at(-1);
    if (last && this.px(last, pt) < SAME_POINT_PX) return; // second click of a double-click
    this.points.push(pt);
    this.ctx.preview.append([pt]);
    if (this.points.length >= this.maxPoints) this.finish();
    else this.draftShape();
  }

  /** Shift snaps the segment from the previous vertex to 15° */
  protected snapped(p: ToolPointer): Pt {
    const last = this.points.at(-1);
    if (!last || !p.shiftKey) return p.world;
    return clampToWorld(snapAngle(last, p.world), this.ctx.worldSize);
  }

  protected withHover(): Pt[] {
    const last = this.points.at(-1);
    return this.hover && last && this.px(last, this.hover) >= 1
      ? [...this.points, this.hover]
      : [...this.points];
  }
}

export class ArrowTool extends VertexTool {
  readonly id = 'arrow';
  protected readonly maxPoints = ELEMENT_LIMITS.arrowPoints;
  private dragged = false;

  override onPointerDown(p: ToolPointer) {
    this.dragged = false;
    super.onPointerDown(p);
  }

  override onPointerMove(p: ToolPointer) {
    const first = this.points[0];
    if (this.starting && this.pressed && first && this.px(first, p.world) > DRAG_THRESHOLD_PX)
      this.dragged = true;
    super.onPointerMove(p);
    if (this.dragged && this.hover) this.ctx.preview.replace([...this.points, this.hover]);
  }

  override onPointerUp(p: ToolPointer) {
    if (this.dragged && this.starting && this.pressed) {
      // press-drag-release: a straight two-point arrow
      const first = this.points[0];
      const end = this.snapped(p);
      this.cancel();
      if (first && this.px(first, end) >= SAME_POINT_PX) this.commitArrow([first, end]);
      return;
    }
    super.onPointerUp(p);
  }

  protected finish() {
    const points = [...this.points];
    this.cancel();
    if (points.length >= 2) this.commitArrow(points);
  }

  private commitArrow(points: Pt[]) {
    this.ctx.commit({
      type: 'ARROW',
      geometry: { points: points.map(mutable) },
      style: this.ctx.style(),
      props: {},
    });
  }

  protected draftShape() {
    this.ctx.setDraft({
      kind: 'path',
      points: this.withHover(),
      closed: false,
      arrow: true,
      style: this.ctx.style(),
    });
  }
}

export class PolygonTool extends VertexTool {
  readonly id = 'polygon';
  protected readonly maxPoints = ELEMENT_LIMITS.polygonPoints;

  override onPointerUp(p: ToolPointer) {
    const first = this.points[0];
    if (
      this.pressed &&
      !this.starting &&
      first &&
      this.points.length >= 3 &&
      this.px(first, p.world) <= CLOSE_POLYGON_PX
    ) {
      this.pressed = false;
      this.finish(); // clicked the first vertex
      return;
    }
    super.onPointerUp(p);
  }

  override onKeyDown(k: ToolKey) {
    if (k.key === 'Backspace' && this.busy) {
      this.points.pop();
      if (this.points.length === 0) this.cancel();
      else this.draftShape();
      return true;
    }
    return super.onKeyDown(k);
  }

  protected finish() {
    const points = [...this.points];
    if (points.length < 3) return; // keep drawing: a polygon needs 3 vertices
    this.cancel();
    this.ctx.commit({
      type: 'POLYGON',
      geometry: { points: points.map(mutable) },
      style: this.ctx.style(),
      props: {},
    });
  }

  protected draftShape() {
    this.ctx.setDraft({
      kind: 'path',
      points: this.withHover(),
      closed: true,
      arrow: false,
      style: this.ctx.style(),
    });
  }
}

// ---- Circle ------------------------------------------------------------------------------

export class CircleTool extends BaseTool {
  readonly id = 'circle';
  private start: Pt | null = null;

  get busy() {
    return this.start !== null;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0 || this.start || !this.ctx.canCreate()) return;
    const preset = this.ctx.presetRadius();
    if (preset !== null) {
      this.commitCircle(p.world, preset);
      return;
    }
    this.start = p.world;
  }

  override onPointerMove(p: ToolPointer) {
    if (!this.start) return;
    const { center, r } = this.shape(p);
    this.ctx.setDraft({
      kind: 'circle',
      center,
      r,
      style: this.ctx.style(),
      label: formatMetres(r / 100),
    });
    this.ctx.preview.replace(circleOutline(center, r, this.ctx.worldSize));
  }

  override onPointerUp(p: ToolPointer) {
    if (!this.start) return;
    const { center, r } = this.shape(p);
    this.start = null;
    this.reset();
    if (r >= ELEMENT_LIMITS.circleRadiusMin) this.commitCircle(center, r);
  }

  override cancel() {
    this.start = null;
    this.reset();
  }

  /** press = centre; with Shift the press is on the edge and the drag spans the diameter */
  private shape(p: ToolPointer): { center: Pt; r: number } {
    const start = this.start ?? p.world;
    const s = p.shiftKey
      ? circleFromEdge(start, p.world)
      : { center: start, r: circleRadius(start, p.world) };
    return { center: s.center, r: Math.min(ELEMENT_LIMITS.circleRadiusMax, s.r) };
  }

  private commitCircle(center: Pt, r: number) {
    this.ctx.commit({
      type: 'CIRCLE',
      geometry: {
        center: mutable(center),
        r: Math.max(
          ELEMENT_LIMITS.circleRadiusMin,
          Math.min(ELEMENT_LIMITS.circleRadiusMax, Math.round(r)),
        ),
      },
      style: this.ctx.style(),
      props: {},
    });
  }
}

/** Circle as a closed polyline, clamped to the map (ghosts only carry points). */
export function circleOutline(center: Pt, r: number, worldSize: number): Pt[] {
  return Array.from({ length: GHOST_CIRCLE_SEGMENTS + 1 }, (_, i) => {
    const a = (i / GHOST_CIRCLE_SEGMENTS) * Math.PI * 2;
    return clampToWorld([center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r], worldSize);
  });
}

// ---- Text --------------------------------------------------------------------------------

export class TextTool extends BaseTool {
  readonly id = 'text';
  override readonly cursor = 'text';
  private at: Pt | null = null;

  get busy() {
    return this.at !== null;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0 || this.at || !this.ctx.canCreate()) return;
    this.at = p.world;
    this.ctx.openText(p.world);
  }

  /** Enter in the inline editor (and blur with text). Empty text just closes it. */
  submit(text: string): boolean {
    const at = this.at;
    this.cancel();
    const value = text.trim();
    if (!at || value.length === 0) return false;
    return this.ctx.commit({
      type: 'TEXT',
      geometry: { at: mutable(at) },
      style: this.ctx.style(),
      props: { text: value.slice(0, ELEMENT_LIMITS.textMax), size: this.ctx.textSize() },
    });
  }

  override cancel() {
    this.at = null;
    this.ctx.closeText();
  }
}

// ---- Marker ------------------------------------------------------------------------------

export class MarkerTool extends BaseTool {
  readonly id = 'marker';
  override readonly cursor = 'cell';

  get busy() {
    return false;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0 || !this.ctx.canCreate()) return;
    const { kind, number, label } = this.ctx.markerProps();
    this.ctx.commit({
      type: 'MARKER',
      geometry: { at: mutable(p.world) },
      style: this.ctx.style(),
      props: {
        kind,
        ...(number !== undefined && { number }),
        ...(label && { label: label.slice(0, ELEMENT_LIMITS.markerLabelMax) }),
      },
    });
  }
}

// ---- helpers -----------------------------------------------------------------------------

function mutable([x, y]: Pt): [number, number] {
  return [x, y];
}

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

/**
 * Measure (R), every role, local only (FEATURES F11): click points, double-click or Enter to
 * finish, Backspace removes the last point, Esc clears. A finished line stays until Esc or the
 * next click, which starts a new one.
 */
export class MeasureTool extends BaseTool {
  readonly id = 'measure';
  private points: Pt[] = [];
  private hover: Pt | null = null;
  private finished = false;

  get busy() {
    return this.points.length > 0 && !this.finished;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0) return;
    if (this.finished) {
      this.points = [];
      this.finished = false;
    }
    const last = this.points.at(-1);
    if (!last || this.px(last, p.world) >= SAME_POINT_PX) this.points.push(p.world);
    this.publish();
  }

  override onPointerMove(p: ToolPointer) {
    if (this.points.length === 0 || this.finished) return;
    this.hover = p.world;
    this.publish();
  }

  override onDoubleClick() {
    this.finish();
  }

  override onKeyDown(k: ToolKey): boolean {
    if (k.key === 'Escape' && this.points.length > 0) {
      this.cancel();
      return true;
    }
    if (k.key === 'Enter' && this.busy) {
      this.finish();
      return true;
    }
    if (k.key === 'Backspace' && this.points.length > 0) {
      this.points.pop();
      if (this.points.length === 0) this.cancel();
      else this.publish();
      return true;
    }
    return false;
  }

  override cancel() {
    this.points = [];
    this.hover = null;
    this.finished = false;
    this.ctx.setMeasure(null);
  }

  private finish() {
    if (this.points.length === 0) return;
    this.finished = true;
    this.hover = null;
    this.publish();
  }

  private publish() {
    this.ctx.setMeasure({ points: [...this.points], hover: this.hover, finished: this.finished });
  }
}

/** Laser (K): hold to draw a fading trail everyone on the board sees (never stored). */
export class LaserTool extends BaseTool {
  readonly id = 'laser';
  private pressed = false;

  get busy() {
    return this.pressed;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0) return;
    this.pressed = true;
    this.ctx.laser(p.world);
  }

  override onPointerMove(p: ToolPointer) {
    if (this.pressed) this.ctx.laser(p.world);
  }

  override onPointerUp() {
    this.pressed = false;
  }

  override cancel() {
    this.pressed = false;
  }
}

export type AnyTool =
  | MeasureTool
  | LaserTool
  | SelectTool
  | EraserTool
  | PenTool
  | LineTool
  | ArrowTool
  | PolygonTool
  | CircleTool
  | TextTool
  | MarkerTool;

/** Tool instances for one map session. */
export function createTools(ctx: ToolContext): Partial<Record<ToolId, AnyTool>> {
  return {
    select: new SelectTool(ctx),
    pen: new PenTool(ctx),
    line: new LineTool(ctx),
    arrow: new ArrowTool(ctx),
    circle: new CircleTool(ctx),
    polygon: new PolygonTool(ctx),
    text: new TextTool(ctx),
    marker: new MarkerTool(ctx),
    eraser: new EraserTool(ctx),
    laser: new LaserTool(ctx),
    measure: new MeasureTool(ctx),
  };
}
