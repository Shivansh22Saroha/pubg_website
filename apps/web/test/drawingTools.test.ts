import type { Layer, Pt, Style } from '@rotationlab/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  creationBlock,
  initials,
  nextMarkerNumber,
  resolveActiveLayer,
} from '@/components/tools/gating';
import { PreviewSender, PREVIEW_MAX_POINTS } from '@/components/tools/previewSender';
import {
  ArrowTool,
  CircleTool,
  LineTool,
  MarkerTool,
  PenTool,
  PolygonTool,
  TextTool,
} from '@/components/tools/tools';
import type { Draft, NewElement, ToolContext, ToolPointer } from '@/components/tools/types';
import type { ViewElement } from '@/stores/boardModel';
import type { MeasureLine } from '@/stores/measureStore';

/** TESTING §3 (web): each tool class — pointer sequences → the expected element. */

const W = 816_000;
const K = 100; // world units per screen px
const STYLE: Style = { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0 };

class Fake {
  commits: NewElement[] = [];
  draft: Draft | null = null;
  previews: string[] = [];
  textOpen: Pt | null = null;
  preset: number | null = null;
  doubleHeaded = false;
  curved = false;
  allowed = true;
  measure: MeasureLine | null = null;

  ctx(): ToolContext {
    return {
      worldSize: W,
      worldPerPx: () => K,
      style: () => STYLE,
      canCreate: () => this.allowed,
      commit: (el) => {
        this.commits.push(el);
        return true;
      },
      setDraft: (d) => {
        this.draft = d;
      },
      preview: {
        begin: () => this.previews.push('begin'),
        append: () => this.previews.push('append'),
        replace: () => this.previews.push('replace'),
        end: () => this.previews.push('end'),
      },
      openText: (at) => {
        this.textOpen = at;
      },
      closeText: () => {
        this.textOpen = null;
      },
      textSize: () => 'lg',
      markerProps: () => ({ kind: 'enemy_squad', number: 3, label: 'Pochinki boys' }),
      presetRadius: () => this.preset,
      arrowDoubleHeaded: () => this.doubleHeaded,
      arrowCurved: () => this.curved,
      scene: () => ({ elements: {}, layers: [], hidden: {}, worldPerPx: K, textScale: 1 }),
      canEdit: () => true,
      selection: () => [],
      select: () => undefined,
      setTransform: () => undefined,
      setMarquee: () => undefined,
      setHighlight: () => undefined,
      commitChanges: () => true,
      editInline: () => undefined,
      explainLocked: () => undefined,
      laser: () => undefined,
      setMeasure: (line) => {
        this.measure = line;
      },
    };
  }
}

const p = (x: number, y: number, shiftKey = false): ToolPointer => ({
  world: [x, y],
  screen: [x / K, y / K],
  shiftKey,
  button: 0,
});
const geometry = (el: NewElement | undefined) =>
  el?.geometry as { points?: Pt[]; center?: Pt; r?: number; at?: Pt };

let fake: Fake;
beforeEach(() => {
  fake = new Fake();
});

describe('Pen', () => {
  it('samples every ≥ 4 px, simplifies, commits a STROKE on release', () => {
    const pen = new PenTool(fake.ctx());
    pen.onPointerDown(p(0, 0));
    pen.onPointerMove(p(100, 0)); // 1 px: not sampled
    for (let i = 1; i <= 10; i++) pen.onPointerMove(p(i * 1_000, 0)); // straight line
    pen.onPointerUp(p(10_000, 0));
    expect(fake.commits).toHaveLength(1);
    expect(fake.commits[0]?.type).toBe('STROKE');
    expect(geometry(fake.commits[0]).points).toEqual([
      [0, 0],
      [10_000, 0],
    ]); // collinear points simplified away
    expect(fake.draft).toBeNull();
  });

  it('a click without movement draws nothing', () => {
    const pen = new PenTool(fake.ctx());
    pen.onPointerDown(p(5, 5));
    pen.onPointerUp(p(5, 5));
    expect(fake.commits).toHaveLength(0);
  });

  it('auto-commits at 2 000 points and carries on as a new stroke', () => {
    const pen = new PenTool(fake.ctx());
    pen.onPointerDown(p(0, 0));
    // a zig-zag survives simplification
    for (let i = 1; i <= 2_100; i++) pen.onPointerMove(p(i * 500, i % 2 === 0 ? 0 : 1_000));
    expect(fake.commits).toHaveLength(1);
    pen.onPointerUp(p(2_100 * 500, 0));
    expect(fake.commits).toHaveLength(2);
    for (const c of fake.commits) expect(geometry(c).points!.length).toBeLessThanOrEqual(2_000);
  });
});

describe('Line', () => {
  it('press-drag-release; Shift snaps to 15°', () => {
    const line = new LineTool(fake.ctx());
    line.onPointerDown(p(100_000, 100_000));
    line.onPointerMove(p(150_000, 101_000, true));
    line.onPointerUp(p(150_000, 101_000, true));
    expect(fake.commits[0]?.type).toBe('LINE');
    const [a, b] = geometry(fake.commits[0]).points!;
    expect(a).toEqual([100_000, 100_000]);
    expect(b![1]).toBe(100_000); // snapped flat
  });

  it('a click (< 3 px) draws nothing', () => {
    const line = new LineTool(fake.ctx());
    line.onPointerDown(p(0, 0));
    line.onPointerUp(p(100, 100));
    expect(fake.commits).toHaveLength(0);
  });
});

describe('Arrow', () => {
  it('click start, click bends, Enter finishes; head at the last point', () => {
    const arrow = new ArrowTool(fake.ctx());
    arrow.onPointerDown(p(0, 0));
    arrow.onPointerUp(p(0, 0));
    arrow.onPointerDown(p(50_000, 0));
    arrow.onPointerUp(p(50_000, 0));
    arrow.onPointerDown(p(50_000, 50_000));
    arrow.onPointerUp(p(50_000, 50_000));
    expect(arrow.onKeyDown({ key: 'Enter', shiftKey: false })).toBe(true);
    expect(fake.commits[0]?.type).toBe('ARROW');
    expect(geometry(fake.commits[0]).points).toEqual([
      [0, 0],
      [50_000, 0],
      [50_000, 50_000],
    ]);
  });

  it('the style bar toggle makes it double-headed (Phase 11); off by default', () => {
    const arrow = new ArrowTool(fake.ctx());
    const draw = () => {
      arrow.onPointerDown(p(0, 0));
      arrow.onPointerUp(p(0, 0));
      arrow.onPointerDown(p(40_000, 0));
      arrow.onPointerUp(p(40_000, 0));
      arrow.onKeyDown({ key: 'Enter', shiftKey: false });
    };
    draw();
    expect(fake.commits[0]?.props).toEqual({});
    fake.doubleHeaded = true;
    draw();
    expect(fake.commits[1]?.props).toEqual({ doubleHeaded: true });
  });

  it('the curved toggle (Phase 12) curves arrows with bends, never a straight two-point one', () => {
    fake.curved = true;
    const arrow = new ArrowTool(fake.ctx());
    const click = (x: number, y: number) => {
      arrow.onPointerDown(p(x, y));
      arrow.onPointerUp(p(x, y));
    };
    click(0, 0);
    click(40_000, 0);
    arrow.onKeyDown({ key: 'Enter', shiftKey: false });
    click(0, 0);
    click(40_000, 0);
    click(40_000, 40_000);
    arrow.onKeyDown({ key: 'Enter', shiftKey: false });
    expect(fake.commits.map((c) => c.props)).toEqual([{}, { curved: true }]);
  });

  it('double-click finishes (its second click is not a new vertex)', () => {
    const arrow = new ArrowTool(fake.ctx());
    arrow.onPointerDown(p(0, 0));
    arrow.onPointerUp(p(0, 0));
    arrow.onPointerDown(p(30_000, 0));
    arrow.onPointerUp(p(30_000, 0));
    arrow.onPointerDown(p(30_000, 0));
    arrow.onPointerUp(p(30_000, 0));
    arrow.onDoubleClick();
    expect(geometry(fake.commits[0]).points).toHaveLength(2);
  });

  it('press-drag-release makes a straight two-point arrow', () => {
    const arrow = new ArrowTool(fake.ctx());
    arrow.onPointerDown(p(0, 0));
    arrow.onPointerMove(p(20_000, 0));
    arrow.onPointerMove(p(40_000, 10_000));
    arrow.onPointerUp(p(40_000, 10_000));
    expect(geometry(fake.commits[0]).points).toEqual([
      [0, 0],
      [40_000, 10_000],
    ]);
  });
});

describe('Polygon', () => {
  const click = (t: PolygonTool, x: number, y: number) => {
    t.onPointerDown(p(x, y));
    t.onPointerUp(p(x, y));
  };

  it('closes by clicking the first vertex', () => {
    const poly = new PolygonTool(fake.ctx());
    click(poly, 0, 0);
    click(poly, 50_000, 0);
    click(poly, 50_000, 50_000);
    click(poly, 300, 200); // within 8 px of the first vertex
    expect(fake.commits[0]?.type).toBe('POLYGON');
    expect(geometry(fake.commits[0]).points).toHaveLength(3);
  });

  it('Backspace removes the last vertex; Enter with < 3 vertices keeps drawing', () => {
    const poly = new PolygonTool(fake.ctx());
    click(poly, 0, 0);
    click(poly, 50_000, 0);
    click(poly, 50_000, 50_000);
    expect(poly.onKeyDown({ key: 'Backspace', shiftKey: false })).toBe(true);
    poly.onKeyDown({ key: 'Enter', shiftKey: false });
    expect(fake.commits).toHaveLength(0);
    expect(poly.busy).toBe(true);
    click(poly, 0, 50_000);
    poly.onKeyDown({ key: 'Enter', shiftKey: false });
    expect(geometry(fake.commits[0]).points).toEqual([
      [0, 0],
      [50_000, 0],
      [0, 50_000],
    ]);
  });

  it('Esc cancels the draft', () => {
    const poly = new PolygonTool(fake.ctx());
    click(poly, 0, 0);
    click(poly, 10_000, 0);
    expect(poly.onKeyDown({ key: 'Escape', shiftKey: false })).toBe(true);
    expect(poly.busy).toBe(false);
    expect(fake.draft).toBeNull();
  });
});

describe('Circle', () => {
  it('press = centre, drag = radius; radius label in metres while drawing', () => {
    const circle = new CircleTool(fake.ctx());
    circle.onPointerDown(p(100_000, 100_000));
    circle.onPointerMove(p(130_000, 140_000));
    expect(fake.draft).toMatchObject({ kind: 'circle', r: 50_000, label: '500 m' });
    circle.onPointerUp(p(130_000, 140_000));
    expect(geometry(fake.commits[0])).toEqual({ center: [100_000, 100_000], r: 50_000 });
  });

  it('Shift draws from the edge; tiny circles are dropped; a preset places on click', () => {
    const circle = new CircleTool(fake.ctx());
    circle.onPointerDown(p(0, 0));
    circle.onPointerUp(p(60_000, 80_000, true));
    expect(geometry(fake.commits[0])).toEqual({ center: [30_000, 40_000], r: 50_000 });
    circle.onPointerDown(p(0, 0));
    circle.onPointerUp(p(50, 0)); // r < 100
    expect(fake.commits).toHaveLength(1);
    fake.preset = 25_000;
    circle.onPointerDown(p(200_000, 200_000));
    expect(geometry(fake.commits[1])).toEqual({ center: [200_000, 200_000], r: 25_000 });
  });
});

describe('Text & Marker', () => {
  it('text: click opens the editor; Enter commits trimmed text with the size; empty commits nothing', () => {
    const text = new TextTool(fake.ctx());
    text.onPointerDown(p(10, 20));
    expect(fake.textOpen).toEqual([10, 20]);
    expect(text.submit('  go school  ')).toBe(true);
    expect(fake.commits[0]).toMatchObject({
      type: 'TEXT',
      geometry: { at: [10, 20] },
      props: { text: 'go school', size: 'lg' },
    });
    text.onPointerDown(p(10, 20));
    expect(text.submit('   ')).toBe(false);
    expect(fake.commits).toHaveLength(1);
  });

  it('marker: one click places the picked kind with its number and label', () => {
    const marker = new MarkerTool(fake.ctx());
    marker.onPointerDown(p(5, 6));
    expect(fake.commits[0]).toMatchObject({
      type: 'MARKER',
      geometry: { at: [5, 6] },
      props: { kind: 'enemy_squad', number: 3, label: 'Pochinki boys' },
    });
  });

  it('nothing happens while creating is blocked', () => {
    fake.allowed = false;
    new MarkerTool(fake.ctx()).onPointerDown(p(5, 6));
    const pen = new PenTool(fake.ctx());
    pen.onPointerDown(p(0, 0));
    pen.onPointerMove(p(10_000, 0));
    pen.onPointerUp(p(10_000, 0));
    expect(fake.commits).toHaveLength(0);
  });
});

describe('gating', () => {
  const layer = (id: string, position: number, locked = false): Layer => ({
    id,
    boardId: 'b',
    name: id,
    color: '#F2A900',
    position,
    visible: true,
    locked,
    seq: 0,
  });

  it('a locked layer blocks drawing for every role, owner included (server rule)', () => {
    const locked = layer('L', 0, true);
    for (const role of ['OWNER', 'EDITOR'] as const)
      expect(creationBlock({ role, layer: locked, elementCount: 0, queueFull: false })).toBe(
        'locked',
      );
    expect(
      creationBlock({ role: 'VIEWER', layer: layer('L', 0), elementCount: 0, queueFull: false }),
    ).toBe('role');
    expect(
      creationBlock({ role: 'EDITOR', layer: layer('L', 0), elementCount: 5000, queueFull: false }),
    ).toBe('board-full');
    expect(
      creationBlock({ role: 'EDITOR', layer: layer('L', 0), elementCount: 0, queueFull: true }),
    ).toBe('queue-full');
    expect(
      creationBlock({ role: 'EDITOR', layer: layer('L', 0), elementCount: 0, queueFull: false }),
    ).toBeNull();
  });

  it('active layer: the pick, else the first unlocked, else the first', () => {
    const ls = [layer('a', 0, true), layer('b', 1), layer('c', 2)];
    expect(resolveActiveLayer(ls, 'c')?.id).toBe('c');
    expect(resolveActiveLayer(ls, 'gone')?.id).toBe('b');
    expect(resolveActiveLayer([layer('a', 0, true)], null)?.id).toBe('a');
  });

  it('enemy squads take the lowest unused number 1–25; own players cycle 1–4', () => {
    const m = (n: number, kind = 'enemy_squad') =>
      ({ id: `${kind}${n}`, type: 'MARKER', props: { kind, number: n } }) as unknown as ViewElement;
    const els = Object.fromEntries([m(1), m(2), m(4)].map((e) => [e.id, e]));
    expect(nextMarkerNumber(els, 'enemy_squad')).toBe(3);
    const players = Object.fromEntries(
      [1, 2, 3, 4].map((n) => m(n, 'own_player')).map((e) => [e.id, e]),
    );
    expect(nextMarkerNumber(players, 'own_player')).toBe(1);
    expect(nextMarkerNumber({}, 'vehicle')).toBeUndefined();
    expect(initials('Team Soul')).toBe('TS');
  });
});

describe('stroke:preview sender', () => {
  it('throttles to 20 Hz and chunks to ≤ 200 points per message', () => {
    let now = 1_000;
    const sent: { tempId: string; n: number }[] = [];
    const timers: (() => void)[] = [];
    let id = 0;
    const s = new PreviewSender({
      emit: (tempId, points) => sent.push({ tempId, n: points.length }),
      style: () => STYLE,
      newId: () => `t${++id}`,
      now: () => now,
      schedule: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    s.begin();
    s.append([[0, 0]]); // first flush is immediate
    expect(sent).toEqual([{ tempId: 't1', n: 1 }]);
    s.append(Array.from({ length: 450 }, (_, i): Pt => [i, i])); // within 50 ms → scheduled
    expect(sent).toHaveLength(1);
    now = 1_050;
    timers.shift()?.();
    expect(sent.slice(1)).toEqual([
      { tempId: 't1', n: PREVIEW_MAX_POINTS },
      { tempId: 't1', n: PREVIEW_MAX_POINTS },
      { tempId: 't1', n: 50 },
    ]);
  });
});
