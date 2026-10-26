import { distance, type Pt } from '@rotationlab/shared';
import type { Tool, ToolContext, ToolId, ToolKey, ToolPointer } from './types';

/** Shared tool plumbing: Esc cancels, reset clears the draft and the ghost. */
export abstract class BaseTool implements Tool {
  abstract readonly id: ToolId;
  readonly cursor: string = 'crosshair';
  constructor(protected readonly ctx: ToolContext) {}
  abstract get busy(): boolean;
  onPointerDown(_p: ToolPointer): void {}
  onPointerMove(_p: ToolPointer): void {}
  onPointerUp(_p: ToolPointer): void {}
  onDoubleClick(_p: ToolPointer): void {}
  onKeyDown(k: ToolKey): boolean {
    if (k.key === 'Escape' && this.busy) {
      this.cancel();
      return true;
    }
    return false;
  }
  cancel(): void {
    this.reset();
  }
  protected reset(): void {
    this.ctx.setDraft(null);
    this.ctx.preview.end();
  }
  /** screen-pixel distance between two world points at the current zoom */
  protected px(a: Pt, b: Pt): number {
    return distance(a, b) / this.ctx.worldPerPx();
  }
}
