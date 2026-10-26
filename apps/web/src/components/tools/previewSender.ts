import type { Pt, Style } from '@rotationlab/shared';
import type { PreviewSink } from './types';

export const PREVIEW_INTERVAL_MS = 50; // 20 Hz
/** StrokePreviewSchema: ≤ 200 points per message */
export const PREVIEW_MAX_POINTS = 200;

export interface PreviewDeps {
  emit: (tempId: string, points: Pt[], style: Style) => void;
  style: () => Style;
  newId: () => string;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

/**
 * Throttles `stroke:preview` to 20 Hz (FEATURES F6). Append mode sends only the points added
 * since the last message under one tempId; replace mode (line, circle, straight-arrow drag)
 * sends the whole small shape under a fresh tempId, which receivers treat as "replace this
 * user's ghost". Best-effort: anything dropped is simply superseded.
 */
export class PreviewSender implements PreviewSink {
  private tempId: string | null = null;
  private mode: 'append' | 'replace' = 'append';
  private buffer: Pt[] = [];
  private last = 0;
  private cancelTimer: (() => void) | null = null;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly deps: PreviewDeps) {
    this.now = deps.now ?? Date.now;
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => {
          clearTimeout(t);
        };
      });
  }

  begin() {
    this.end();
    this.tempId = this.deps.newId();
    this.mode = 'append';
  }

  append(points: Pt[]) {
    if (!this.tempId || this.mode !== 'append') this.begin();
    this.buffer.push(...points);
    this.kick();
  }

  replace(points: Pt[]) {
    this.mode = 'replace';
    this.buffer = [...points];
    this.kick();
  }

  end() {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.buffer = [];
    this.tempId = null;
  }

  private kick() {
    const wait = this.last + PREVIEW_INTERVAL_MS - this.now();
    if (wait <= 0) this.flush();
    else
      this.cancelTimer ??= this.schedule(() => {
        this.cancelTimer = null;
        this.flush();
      }, wait);
  }

  private flush() {
    if (this.buffer.length === 0) return;
    this.last = this.now();
    if (this.mode === 'replace' || !this.tempId) this.tempId = this.deps.newId();
    const points = this.buffer;
    this.buffer = [];
    const style = this.deps.style();
    for (let i = 0; i < points.length; i += PREVIEW_MAX_POINTS)
      this.deps.emit(this.tempId, points.slice(i, i + PREVIEW_MAX_POINTS), style);
  }
}
