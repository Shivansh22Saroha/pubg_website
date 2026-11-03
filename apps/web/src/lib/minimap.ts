/**
 * Minimap geometry (Phase 11, UI_UX_SPEC §3.5): the whole map drawn in `size` px; world units
 * ↔ minimap pixels, and the main view's rectangle clamped to the minimap.
 */
export const MINIMAP_PX = 160;

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** the viewport rectangle on the minimap; null when the view is entirely off the map */
export function viewportRect(view: WorldRect, worldSpan: number, size = MINIMAP_PX): PxRect | null {
  const k = size / worldSpan;
  const left = clamp(view.minX * k, 0, size);
  const top = clamp(view.minY * k, 0, size);
  const right = clamp(view.maxX * k, 0, size);
  const bottom = clamp(view.maxY * k, 0, size);
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** a point on the minimap (px from its top-left) → world units, clamped to the map */
export function minimapToWorld(
  px: number,
  py: number,
  worldSize: number,
  worldSpan: number,
  size = MINIMAP_PX,
): [number, number] {
  const k = worldSpan / size;
  return [Math.round(clamp(px * k, 0, worldSize)), Math.round(clamp(py * k, 0, worldSize))];
}

/** arrow keys on the focused minimap pan by a tenth of the map */
export function keyPan(key: string, worldSize: number): [number, number] | null {
  const step = worldSize / 10;
  switch (key) {
    case 'ArrowLeft':
      return [-step, 0];
    case 'ArrowRight':
      return [step, 0];
    case 'ArrowUp':
      return [0, -step];
    case 'ArrowDown':
      return [0, step];
    default:
      return null;
  }
}
