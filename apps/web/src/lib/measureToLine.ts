import { ElementInputSchema, type ElementInput, type Pt, type Style } from '@rotationlab/shared';

/**
 * "Save as line" on the Measure tool (Phase 11, FEATURES F11): the measured path as LINE
 * elements. A LINE has exactly two points, so a measure of N points becomes N − 1 lines
 * (zero-length segments skipped) — saved as one action, so one undo removes them all.
 */
export function measureLines(
  points: readonly Pt[],
  o: { boardId: string; layerId: string; style: Style; newId: () => string },
): ElementInput[] {
  const out: ElementInput[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
    const parsed = ElementInputSchema.safeParse({
      id: o.newId(),
      boardId: o.boardId,
      layerId: o.layerId,
      type: 'LINE',
      geometry: {
        points: [
          [Math.round(a[0]), Math.round(a[1])],
          [Math.round(b[0]), Math.round(b[1])],
        ],
      },
      style: o.style,
      props: {},
      z: 0,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
