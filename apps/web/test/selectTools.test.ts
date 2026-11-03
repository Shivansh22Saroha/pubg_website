import type { BBox, Layer, Pt } from '@rotationlab/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampMove,
  DUPLICATE_OFFSET,
  duplicateChanges,
  idsOnLayer,
  pickAlong,
  pickInBox,
  pickTop,
  withTransform,
  type Scene,
} from '@/components/tools/scene';
import { EraserTool, SelectTool } from '@/components/tools/selectTools';
import type { ToolContext, ToolPointer } from '@/components/tools/types';
import type { Change, ViewElement } from '@/stores/boardModel';
import type { Transform } from '@/stores/selectionStore';

/** Select & eraser (FEATURES F6): hit priority, marquee, move batching, sweep, duplicate. */

const BOARD = '0192f7a1-0000-7000-8000-00000000000b';
const W = 816_000;
const K = 100; // world units per screen px in these tests

const layer = (id: string, position: number, over: Partial<Layer> = {}): Layer => ({
  id,
  boardId: BOARD,
  name: id,
  color: '#F2A900',
  position,
  visible: true,
  locked: false,
  seq: 1,
  ...over,
});

const base = (id: string, layerId: string, z = 0) => ({
  id,
  boardId: BOARD,
  layerId,
  style: { color: '#F2A900', width: 4 as const, dashed: false, fillOpacity: 0 },
  z,
  seq: 1,
  createdBy: null,
  updatedBy: null,
  updatedAt: '2026-10-26T10:00:00.000Z',
});

const line = (id: string, layerId: string, a: Pt, b: Pt, z = 0): ViewElement => ({
  ...base(id, layerId, z),
  type: 'LINE',
  geometry: { points: [a, b] },
  props: {},
});
const marker = (id: string, layerId: string, at: Pt, z = 0): ViewElement => ({
  ...base(id, layerId, z),
  type: 'MARKER',
  geometry: { at },
  props: { kind: 'pin' },
});
const circle = (id: string, layerId: string, center: Pt, r: number): ViewElement => ({
  ...base(id, layerId),
  type: 'CIRCLE',
  geometry: { center, r },
  props: {},
});

function makeScene(
  elements: ViewElement[],
  layers: Layer[],
  hidden: Record<string, true> = {},
): Scene {
  return {
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
    layers,
    hidden,
    worldPerPx: K,
    textScale: 1,
  };
}

// two crossing lines at (50 000, 50 000) on two layers, plus a marker and a circle
const bottom = layer('bottom', 0);
const top = layer('top', 1);
const crossing = () =>
  makeScene(
    [
      line('lowZ', 'top', [40_000, 50_000], [60_000, 50_000], 0),
      line('highZ', 'top', [50_000, 40_000], [50_000, 60_000], 5),
      line('under', 'bottom', [40_000, 40_000], [60_000, 60_000], 99),
      marker('m', 'bottom', [100_000, 100_000]),
      circle('c', 'bottom', [200_000, 200_000], 10_000),
    ],
    [bottom, top],
  );

describe('hit-test priority', () => {
  it('layer order first, then z', () => {
    const s = crossing();
    expect(pickTop(s, [50_000, 50_000])?.id).toBe('highZ'); // top layer, higher z
    const noTop = { ...s, layers: [bottom, { ...top, visible: false }] };
    expect(pickTop(noTop, [50_000, 50_000])?.id).toBe('under'); // z 99 but lower layer
  });

  it('locked and hidden (board-wide or local) layers are ignored', () => {
    const s = crossing();
    expect(
      pickTop({ ...s, layers: [bottom, { ...top, locked: true }] }, [50_000, 50_000])?.id,
    ).toBe('under');
    expect(pickTop({ ...s, hidden: { top: true } }, [50_000, 50_000])?.id).toBe('under');
    expect(
      pickTop(
        {
          ...s,
          layers: [
            { ...bottom, locked: true },
            { ...top, locked: true },
          ],
        },
        [50_000, 50_000],
      ),
    ).toBeUndefined();
  });

  it('uses screen tolerance: a line within ~6 px hits, further away misses', () => {
    const s = crossing();
    expect(pickTop(s, [45_000, 50_500])?.id).toBe('lowZ'); // 5 px off
    expect(pickTop(s, [45_000, 51_500])).toBeUndefined(); // 15 px off
  });

  it('markers hit within their 28 px icon', () => {
    const s = crossing();
    expect(pickTop(s, [101_300, 98_700])?.id).toBe('m');
    expect(pickTop(s, [101_600, 100_000])).toBeUndefined();
  });

  it('an unfilled circle hits on its ring only', () => {
    const s = crossing();
    expect(pickTop(s, [210_000, 200_000])?.id).toBe('c');
    expect(pickTop(s, [200_000, 200_000])).toBeUndefined();
  });
});

describe('marquee and select-all', () => {
  it('selects elements whose bounding box intersects the box, editable layers only', () => {
    const s = crossing();
    const box: BBox = { minX: 45_000, minY: 55_000, maxX: 120_000, maxY: 120_000 };
    expect(pickInBox(s, box).sort()).toEqual(['highZ', 'm', 'under']);
    expect(pickInBox({ ...s, layers: [{ ...bottom, locked: true }, top] }, box)).toEqual(['highZ']);
  });

  it('Ctrl+A: everything on the active layer, nothing on a locked one', () => {
    const s = crossing();
    expect(idsOnLayer(s, 'bottom').sort()).toEqual(['c', 'm', 'under']);
    expect(idsOnLayer({ ...s, layers: [{ ...bottom, locked: true }, top] }, 'bottom')).toEqual([]);
  });
});

describe('eraser sweep geometry', () => {
  it('collects everything the path touches, even between far-apart samples', () => {
    const s = makeScene(
      [
        line('a', 'bottom', [10_000, 0], [10_000, 100_000]),
        line('b', 'bottom', [20_000, 0], [20_000, 100_000]),
        line('c', 'bottom', [30_000, 0], [30_000, 100_000]),
        line('far', 'bottom', [90_000, 0], [90_000, 100_000]),
      ],
      [bottom],
    );
    // one pointer jump across three lines
    expect(pickAlong(s, [0, 50_000], [40_000, 50_000]).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('moves, duplicates', () => {
  it('clamps a move so the whole selection stays inside the map', () => {
    const s = crossing();
    expect(clampMove(s.elements, ['lowZ', 'highZ'], -100_000, 0, W)).toEqual([-40_000, 0]);
    expect(clampMove(s.elements, ['lowZ'], 10, 20, W)).toEqual([10, 20]);
  });

  it('withTransform moves only the dragged elements; the rest keep identity', () => {
    const s = crossing();
    const t: Transform = { kind: 'move', ids: ['m'], dx: 5, dy: 5 };
    const out = withTransform(s.elements, t);
    expect(out.m?.geometry).toEqual({ at: [100_005, 100_005] });
    expect(out.lowZ).toBe(s.elements.lowZ);
    expect(withTransform(s.elements, null)).toBe(s.elements);
  });

  it('duplicate: new ids, offset by 2 000 cm, one change per element', () => {
    const s = crossing();
    let i = 0;
    const changes = duplicateChanges(s.elements, ['m', 'c'], W, () => `copy-${++i}`);
    expect(changes.map((c) => [c.id, c.before, c.after?.id])).toEqual([
      ['copy-1', null, 'copy-1'],
      ['copy-2', null, 'copy-2'],
    ]);
    expect(changes[0]?.after?.geometry).toEqual({
      at: [100_000 + DUPLICATE_OFFSET, 100_000 + DUPLICATE_OFFSET],
    });
    expect(changes[1]?.after?.geometry).toEqual({
      center: [200_000 + DUPLICATE_OFFSET, 200_000 + DUPLICATE_OFFSET],
      r: 10_000,
    });
  });

  it('duplicate near the edge shifts the group as far as it can', () => {
    const s = makeScene([marker('edge', 'bottom', [W - 500, 10])], [bottom]);
    const [c] = duplicateChanges(s.elements, ['edge'], W, () => 'x');
    expect(c?.after?.geometry).toEqual({ at: [W, 10 + DUPLICATE_OFFSET] });
  });
});

// ---- tools with a fake context --------------------------------------------------------------

class FakeCtx {
  scene: Scene = crossing();
  selected: string[] = [];
  transform: Transform | null = null;
  marquee: BBox | null = null;
  highlight: string[] = [];
  commits: Change[][] = [];
  edited: string[] = [];
  lockedToasts: string[] = [];
  editor = true;

  asContext(): ToolContext {
    const preview = { begin() {}, append() {}, replace() {}, end() {} };
    return {
      worldSize: W,
      worldPerPx: () => K,
      style: () => ({ color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 }),
      canCreate: () => true,
      commit: () => true,
      setDraft: () => undefined,
      preview,
      openText: () => undefined,
      closeText: () => undefined,
      textSize: () => 'md',
      markerProps: () => ({ kind: 'pin' }),
      presetRadius: () => null,
      arrowDoubleHeaded: () => false,
      arrowCurved: () => false,
      scene: () => this.scene,
      canEdit: () => this.editor,
      selection: () => this.selected,
      select: (ids) => {
        this.selected = [...new Set(ids)];
      },
      setTransform: (t) => {
        this.transform = t;
      },
      setMarquee: (b) => {
        this.marquee = b;
      },
      setHighlight: (ids) => {
        this.highlight = ids;
      },
      commitChanges: (changes) => {
        this.commits.push(changes);
        return true;
      },
      editInline: (id) => {
        this.edited.push(id);
      },
      explainLocked: (l) => {
        this.lockedToasts.push(l.name);
      },
      laser: () => undefined,
      setMeasure: () => undefined,
    };
  }
}

/** a pointer at world `p`; screen = world / K (so screen px track world here) */
const at = (p: Pt, shiftKey = false): ToolPointer => ({
  world: p,
  screen: [p[0] / K, p[1] / K],
  shiftKey,
  button: 0,
});

let fake: FakeCtx;
let select: SelectTool;
beforeEach(() => {
  fake = new FakeCtx();
  select = new SelectTool(fake.asContext());
});

describe('SelectTool', () => {
  it('click selects the topmost element; click on empty map clears (and is left to Leaflet)', () => {
    expect(select.onPointerDown(at([50_000, 50_000]))).toBe(true);
    select.onPointerUp(at([50_000, 50_000]));
    expect(fake.selected).toEqual(['highZ']);
    expect(select.onPointerDown(at([500_000, 500_000]))).toBe(false); // Leaflet pans
    select.onPointerUp(at([500_000, 500_000]));
    expect(fake.selected).toEqual([]);
  });

  it('a press on empty map that panned (screen moved) keeps the selection', () => {
    fake.selected = ['m'];
    select.onPointerDown(at([500_000, 500_000]));
    select.onPointerUp({ ...at([500_000, 500_000]), screen: [5_100, 5_000] });
    expect(fake.selected).toEqual(['m']);
  });

  it('Shift+click toggles an element in the selection', () => {
    select.onPointerDown(at([100_000, 100_000]));
    select.onPointerUp(at([100_000, 100_000]));
    select.onPointerDown(at([50_000, 50_000], true));
    select.onPointerUp(at([50_000, 50_000], true));
    expect(fake.selected).toEqual(['m', 'highZ']);
    select.onPointerDown(at([100_000, 100_000], true));
    select.onPointerUp(at([100_000, 100_000], true));
    expect(fake.selected).toEqual(['highZ']);
  });

  it('dragging a selected element moves the whole selection: previewed live, one commit on release', () => {
    fake.selected = ['m', 'c'];
    select.onPointerDown(at([100_000, 100_000]));
    for (let i = 1; i <= 20; i++) select.onPointerMove(at([100_000 + i * 1_000, 100_000]));
    expect(fake.commits).toHaveLength(0); // nothing sent while dragging
    expect(fake.transform).toEqual({ kind: 'move', ids: ['m', 'c'], dx: 20_000, dy: 0 });
    select.onPointerUp(at([120_000, 100_000]));
    expect(fake.transform).toBeNull();
    expect(fake.commits).toHaveLength(1);
    const [changes] = fake.commits;
    expect(changes?.map((c) => c.id)).toEqual(['m', 'c']);
    expect(changes?.[0]?.after?.geometry).toEqual({ at: [120_000, 100_000] });
    expect(changes?.[1]?.after?.geometry).toEqual({ center: [220_000, 200_000], r: 10_000 });
  });

  it('a tiny jitter (< 3 px) is a click, not a move', () => {
    fake.selected = ['m'];
    select.onPointerDown(at([100_000, 100_000]));
    select.onPointerMove(at([100_100, 100_000]));
    select.onPointerUp(at([100_100, 100_000]));
    expect(fake.commits).toHaveLength(0);
  });

  it('Shift+drag on empty map draws a marquee and adds what it touches', () => {
    fake.selected = ['c'];
    expect(select.onPointerDown(at([95_000, 95_000], true))).toBe(true);
    select.onPointerMove(at([105_000, 105_000], true));
    expect(fake.marquee).toEqual({ minX: 95_000, minY: 95_000, maxX: 105_000, maxY: 105_000 });
    select.onPointerUp(at([105_000, 105_000], true));
    expect(fake.marquee).toBeNull();
    expect(fake.selected).toEqual(['c', 'm']);
  });

  it('the radius handle of a selected circle resizes it (one commit)', () => {
    fake.selected = ['c'];
    expect(select.onPointerDown(at([210_000, 200_000]))).toBe(true); // handle on the east edge
    select.onPointerMove(at([230_000, 200_000]));
    expect(fake.transform).toEqual({ kind: 'radius', id: 'c', r: 30_000 });
    select.onPointerUp(at([230_000, 200_000]));
    expect(fake.commits[0]?.[0]?.after?.geometry).toEqual({
      center: [200_000, 200_000],
      r: 30_000,
    });
  });

  it('elements on a locked layer can’t be selected; the user is told why', () => {
    fake.scene = { ...fake.scene, layers: [{ ...bottom, locked: true }, top] };
    select.onPointerDown(at([100_000, 100_000]));
    select.onPointerUp(at([100_000, 100_000]));
    expect(fake.selected).toEqual([]);
    expect(fake.lockedToasts).toEqual(['bottom']);
  });

  it('double-click on a marker or text edits it inline', () => {
    expect(select.onDoubleClick(at([100_000, 100_000]))).toBe(true);
    expect(fake.edited).toEqual(['m']);
    expect(select.onDoubleClick(at([50_000, 50_000]))).toBe(false); // a line: no inline edit
  });

  it('viewers: presses go to Leaflet, nothing gets selected', () => {
    fake.editor = false;
    expect(select.onPointerDown(at([100_000, 100_000]))).toBe(false);
    expect(fake.selected).toEqual([]);
  });

  it('Esc cancels a drag, then clears the selection', () => {
    fake.selected = ['m'];
    select.onPointerDown(at([100_000, 100_000]));
    select.onPointerMove(at([110_000, 100_000]));
    expect(select.onKeyDown({ key: 'Escape', shiftKey: false })).toBe(true);
    expect(fake.transform).toBeNull();
    expect(fake.selected).toEqual(['m']);
    expect(select.onKeyDown({ key: 'Escape', shiftKey: false })).toBe(true);
    expect(fake.selected).toEqual([]);
  });
});

describe('EraserTool', () => {
  it('click deletes only the topmost element under the cursor', () => {
    const eraser = new EraserTool(fake.asContext());
    eraser.onPointerDown(at([50_000, 50_000]));
    eraser.onPointerUp(at([50_000, 50_000]));
    expect(fake.commits).toHaveLength(1);
    expect(fake.commits[0]?.map((c) => [c.id, c.after])).toEqual([['highZ', null]]);
  });

  it('a drag deletes everything it touched, highlighted during the drag, in one commit', () => {
    fake.scene = makeScene(
      [
        line('a', 'bottom', [10_000, 0], [10_000, 100_000]),
        line('b', 'bottom', [20_000, 0], [20_000, 100_000]),
        line('c', 'bottom', [30_000, 0], [30_000, 100_000]),
        line('far', 'bottom', [90_000, 0], [90_000, 100_000]),
      ],
      [bottom],
    );
    const eraser = new EraserTool(fake.asContext());
    eraser.onPointerDown(at([0, 50_000]));
    eraser.onPointerMove(at([15_000, 50_000]));
    expect(fake.highlight).toEqual(['a']);
    eraser.onPointerMove(at([35_000, 50_000]));
    expect(fake.highlight.sort()).toEqual(['a', 'b', 'c']);
    expect(fake.commits).toHaveLength(0);
    eraser.onPointerUp(at([35_000, 50_000]));
    expect(fake.commits).toHaveLength(1);
    expect(fake.commits[0]?.map((c) => c.id).sort()).toEqual(['a', 'b', 'c']);
    expect(fake.highlight).toEqual([]);
  });

  it('respects locks and roles', () => {
    fake.scene = { ...fake.scene, layers: [bottom, { ...top, locked: true }] };
    const eraser = new EraserTool(fake.asContext());
    eraser.onPointerDown(at([45_000, 50_000])); // only the locked layer's line is here
    eraser.onPointerUp(at([45_000, 50_000]));
    expect(fake.commits).toHaveLength(0);
    expect(fake.lockedToasts).toEqual(['top']);
    fake.editor = false;
    eraser.onPointerDown(at([100_000, 100_000]));
    eraser.onPointerUp(at([100_000, 100_000]));
    expect(fake.commits).toHaveLength(0);
  });
});
