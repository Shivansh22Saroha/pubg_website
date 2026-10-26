/**
 * Select (V) and Eraser (E) — FEATURES F6, UI_UX_SPEC §5/§6. Like the drawing tools these are
 * state machines over world-unit pointer samples; hit-testing lives in `scene.ts`.
 *
 * Select: click = topmost element (layer order, then z) on a shown, unlocked layer; Shift+click
 * toggles; click on empty map clears; Shift+drag on empty map = marquee; plain drag on empty map
 * is left to Leaflet (pan). Dragging a selected element moves the whole selection — previewed
 * locally, committed once on release. A selected circle's radius handle resizes it.
 */
import { bboxFromCorners, distance, type Pt } from '@rotationlab/shared';
import { BaseTool } from './baseTool';
import {
  clampMove,
  clampRadius,
  isEditable,
  lockedLayerAt,
  pickAll,
  pickAlong,
  pickInBox,
  pickRadiusHandle,
  pickTop,
  deleteChanges,
  transformChanges,
} from './scene';
import type { ToolKey, ToolPointer } from './types';

/** A press that travels less than this (screen px) is a click (Leaflet's clickTolerance). */
export const CLICK_PX = 3;

type SelectState =
  | { kind: 'idle' }
  /** pressed on an element; becomes a move once the pointer travels */
  | { kind: 'press'; id: string; wasSelected: boolean; shift: boolean; start: Pt; screen: Pt }
  | { kind: 'move'; ids: string[]; start: Pt }
  | { kind: 'radius'; id: string; center: Pt }
  | { kind: 'marquee'; start: Pt }
  /** pressed on empty map: Leaflet may pan; a release in place clears the selection */
  | { kind: 'empty'; screen: Pt };

function screenDist(a: Pt, b: Pt) {
  return distance(a, b);
}

export class SelectTool extends BaseTool {
  readonly id = 'select';
  override readonly cursor = '';
  private state: SelectState = { kind: 'idle' };

  get busy() {
    return (
      this.state.kind === 'move' || this.state.kind === 'radius' || this.state.kind === 'marquee'
    );
  }

  override onPointerDown(p: ToolPointer): boolean {
    this.state = { kind: 'idle' };
    if (p.button !== 0) return false;
    const scene = this.ctx.scene();
    const selection = this.ctx.selection();
    const handle = pickRadiusHandle(scene, selection, p.world);
    if (handle && this.ctx.canEdit()) {
      const center = (handle.geometry as { center: Pt }).center;
      this.state = { kind: 'radius', id: handle.id, center };
      return true;
    }
    const hit = pickTop(scene, p.world);
    if (hit) {
      if (!this.ctx.canEdit()) return false;
      const wasSelected = selection.includes(hit.id);
      if (p.shiftKey) {
        if (!wasSelected) this.ctx.select([...selection, hit.id]);
      } else if (!wasSelected) {
        this.ctx.select([hit.id]);
      }
      this.state = {
        kind: 'press',
        id: hit.id,
        wasSelected,
        shift: p.shiftKey,
        start: p.world,
        screen: p.screen,
      };
      return true;
    }
    const locked = lockedLayerAt(scene, p.world);
    if (locked) this.ctx.explainLocked(locked);
    if (p.shiftKey) {
      if (!this.ctx.canEdit()) return false;
      this.state = { kind: 'marquee', start: p.world };
      return true;
    }
    this.state = { kind: 'empty', screen: p.screen };
    return false;
  }

  override onPointerMove(p: ToolPointer) {
    const s = this.state;
    switch (s.kind) {
      case 'press': {
        if (screenDist(s.screen, p.screen) < CLICK_PX) return;
        const scene = this.ctx.scene();
        const ids = this.ctx.selection().filter((id) => isEditable(scene, id));
        if (ids.length === 0) {
          this.state = { kind: 'idle' };
          return;
        }
        this.state = { kind: 'move', ids, start: s.start };
        this.onPointerMove(p);
        return;
      }
      case 'move': {
        const [dx, dy] = clampMove(
          this.ctx.scene().elements,
          s.ids,
          p.world[0] - s.start[0],
          p.world[1] - s.start[1],
          this.ctx.worldSize,
        );
        this.ctx.setTransform({ kind: 'move', ids: s.ids, dx, dy });
        return;
      }
      case 'radius':
        this.ctx.setTransform({
          kind: 'radius',
          id: s.id,
          r: clampRadius(distance(s.center, p.world)),
        });
        return;
      case 'marquee':
        this.ctx.setMarquee(bboxFromCorners(s.start, p.world));
        return;
      default:
        return;
    }
  }

  override onPointerUp(p: ToolPointer) {
    const s = this.state;
    this.state = { kind: 'idle' };
    switch (s.kind) {
      case 'press': {
        // a click on an element (no drag)
        const selection = this.ctx.selection();
        if (s.shift && s.wasSelected) this.ctx.select(selection.filter((id) => id !== s.id));
        else if (!s.shift && s.wasSelected && selection.length > 1) this.ctx.select([s.id]);
        return;
      }
      case 'move':
      case 'radius': {
        const elements = this.ctx.scene().elements;
        const t =
          s.kind === 'move'
            ? (() => {
                const [dx, dy] = clampMove(
                  elements,
                  s.ids,
                  p.world[0] - s.start[0],
                  p.world[1] - s.start[1],
                  this.ctx.worldSize,
                );
                return { kind: 'move' as const, ids: s.ids, dx, dy };
              })()
            : { kind: 'radius' as const, id: s.id, r: clampRadius(distance(s.center, p.world)) };
        // commit first, then drop the preview: both land in the same frame, no flicker
        this.ctx.commitChanges(transformChanges(elements, t));
        this.ctx.setTransform(null);
        return;
      }
      case 'marquee': {
        const box = bboxFromCorners(s.start, p.world);
        this.ctx.setMarquee(null);
        const picked = pickInBox(this.ctx.scene(), box);
        this.ctx.select([...this.ctx.selection(), ...picked]); // Shift = additive
        return;
      }
      case 'empty':
        if (screenDist(s.screen, p.screen) < CLICK_PX) this.ctx.select([]);
        return;
      default:
        return;
    }
  }

  override onDoubleClick(p: ToolPointer): boolean {
    const hit = pickTop(this.ctx.scene(), p.world);
    if (!hit || (hit.type !== 'TEXT' && hit.type !== 'MARKER') || !this.ctx.canEdit()) return false;
    this.ctx.select([hit.id]);
    this.ctx.editInline(hit.id);
    return true;
  }

  override onKeyDown(k: ToolKey): boolean {
    if (k.key !== 'Escape') return false;
    if (this.busy) {
      this.cancel();
      return true;
    }
    if (this.ctx.selection().length > 0) {
      this.ctx.select([]);
      return true;
    }
    return false;
  }

  override cancel() {
    this.state = { kind: 'idle' };
    this.ctx.setTransform(null);
    this.ctx.setMarquee(null);
    this.reset();
  }
}

/** Eraser (E): click deletes the element under the cursor; a drag deletes all it touches. */
export class EraserTool extends BaseTool {
  readonly id = 'eraser';
  private press: { start: Pt; screen: Pt; last: Pt; top: string | null; sweep: boolean } | null =
    null;
  private hits = new Set<string>();

  get busy() {
    return this.press !== null;
  }

  override onPointerDown(p: ToolPointer) {
    if (p.button !== 0 || this.press || !this.ctx.canEdit()) return;
    const scene = this.ctx.scene();
    const top = pickTop(scene, p.world);
    if (!top) {
      const locked = lockedLayerAt(scene, p.world);
      if (locked) this.ctx.explainLocked(locked);
    }
    this.press = {
      start: p.world,
      screen: p.screen,
      last: p.world,
      top: top?.id ?? null,
      sweep: false,
    };
    this.hits = new Set(top ? [top.id] : []);
    this.ctx.setHighlight([...this.hits]);
  }

  override onPointerMove(p: ToolPointer) {
    const scene = this.ctx.scene();
    const press = this.press;
    if (!press) {
      // hover: show what a click would erase
      const top = pickTop(scene, p.world);
      this.ctx.setHighlight(top ? [top.id] : []);
      return;
    }
    if (!press.sweep) {
      if (screenDist(press.screen, p.screen) < CLICK_PX) return;
      press.sweep = true;
      for (const id of pickAll(scene, press.start)) this.hits.add(id);
    }
    for (const id of pickAlong(scene, press.last, p.world)) this.hits.add(id);
    press.last = p.world;
    this.ctx.setHighlight([...this.hits]);
  }

  override onPointerUp(p: ToolPointer) {
    const press = this.press;
    if (!press) return;
    if (press.sweep)
      for (const id of pickAlong(this.ctx.scene(), press.last, p.world)) this.hits.add(id);
    const ids = press.sweep ? [...this.hits] : press.top ? [press.top] : [];
    this.press = null;
    this.hits.clear();
    this.ctx.setHighlight([]);
    if (ids.length > 0) this.ctx.commitChanges(deleteChanges(this.ctx.scene().elements, ids));
  }

  override cancel() {
    this.press = null;
    this.hits.clear();
    this.ctx.setHighlight([]);
    this.reset();
  }
}
