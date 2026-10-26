import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultChoice } from '@/components/settings/SettingsPage';
import { StyleBar } from '@/components/tools/StyleBar';
import { MeasureTool } from '@/components/tools/tools';
import type { ToolContext, ToolPointer } from '@/components/tools/types';
import {
  composeExport,
  exportFileName,
  FOOTER_PX,
  footerText,
  selectExportNodes,
  slug,
  type Ctx,
  type ExportSources,
} from '@/lib/exportPng';
import type { MeasureLine } from '@/stores/measureStore';
import { useToolStore } from '@/stores/toolStore';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

// ---- export composition ---------------------------------------------------------------------

/** Records every draw call, tagging images by their `id`. */
function recorder() {
  const calls: string[] = [];
  const tag = (img: unknown) => (img as { id?: string }).id ?? '?';
  const ctx = {
    fillStyle: '' as string,
    font: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    textAlign: 'start' as CanvasTextAlign,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    scale: (x: number, y: number) => calls.push(`scale ${x},${y}`),
    drawImage: (img: unknown) => calls.push(`image ${tag(img)}`),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`rect ${x},${y},${w},${h}`),
    fillText: (t: string) => calls.push(`text ${t}`),
    beginPath: () => undefined,
    roundRect: () => undefined,
    fill: () => calls.push('pill'),
    measureText: () => ({ width: 10 }) as TextMetrics,
  };
  return { calls, ctx: ctx as unknown as Ctx };
}

const img = (id: string) => ({ id }) as unknown as CanvasImageSource;
const r = { x: 0, y: 0, w: 10, h: 10 };

describe('export composition (FEATURES F12)', () => {
  const sources: ExportSources = {
    width: 800,
    height: 600,
    scale: 2,
    images: [
      { ...r, img: img('lowres') },
      { ...r, img: img('tile-1') },
      { ...r, img: img('tile-2') },
    ],
    grid: { ...r, canvas: img('grid') },
    gridLabels: [{ ...r, text: 'A' }],
    vectors: [{ ...r, canvas: img('elements') }],
    markers: [{ ...r, img: img('marker'), label: { ...r, text: 'Pochinki' } }],
    texts: [{ ...r, text: 'go school', color: '#F8FAFC', fontPx: 14 }],
    footer: 'Team Soul · Plan A · Erangel · 26/10/2026 · PUBG map imagery © KRAFTON',
  };

  it('draws tiles → grid → elements → markers → text → footer, at the device scale', () => {
    const { calls, ctx } = recorder();
    composeExport(ctx, sources);
    const order = calls.filter((c) => c.startsWith('image') || c.startsWith('text'));
    expect(order).toEqual([
      'image lowres',
      'image tile-1',
      'image tile-2',
      'image grid',
      'text A',
      'image elements',
      'image marker',
      'text Pochinki',
      'text go school',
      `text ${sources.footer}`,
    ]);
    expect(calls[1]).toBe('scale 2,2');
    // the footer strip overlays the bottom: the image stays viewport × scale
    expect(calls).toContain(`rect 0,${600 - FOOTER_PX},800,${FOOTER_PX}`);
    expect(calls.at(-1)).toBe('restore');
  });

  it('no grid when it is hidden', () => {
    const { calls, ctx } = recorder();
    composeExport(ctx, { ...sources, grid: null, gridLabels: [] });
    expect(calls).not.toContain('image grid');
  });

  it('collects only the picture: never cursors, laser, selection, drafts, ghosts or pulses', () => {
    document.body.innerHTML = `
      <div data-testid="map-canvas">
        <div class="isolate"><div class="leaflet-container" id="map">
          <div class="leaflet-placeholder-pane"><img id="lowres"></div>
          <div class="tiles-labels"><img class="leaflet-tile-loaded" id="t-labels"><img id="t-loading"></div>
          <div class="tiles-clean"><img class="leaflet-tile-loaded" id="t-clean"></div>
          <div class="leaflet-grid-pane"><canvas id="grid"></canvas></div>
          <div class="leaflet-elements-pane"><canvas id="elements"></canvas></div>
          <div class="leaflet-drafts-pane"><svg id="draft"></svg></div>
          <div class="leaflet-selection-pane"><svg id="selection"></svg></div>
          <div class="leaflet-pulses-pane"><div class="rl-pulse-icon" id="pulse"></div></div>
          <div class="leaflet-marker-pane">
            <div class="rl-marker-icon" id="marker"><div class="rl-marker"><svg></svg></div></div>
            <div class="rl-text-icon"><div class="rl-text" id="text">go</div></div>
            <div class="rl-cursor-icon" id="cursor"><div class="rl-cursor"></div></div>
          </div>
          <canvas class="rl-laser" id="laser"></canvas>
        </div></div>
        <div data-testid="grid-labels"><span id="label-a">A</span></div>
      </div>`;
    const container = document.getElementById('map')!;
    const ids = (els: Element[]) => els.map((e) => e.id);
    const n = selectExportNodes(container, 'labels', true);
    expect(ids(n.placeholder)).toEqual(['lowres']);
    expect(ids(n.tiles)).toEqual(['t-labels']); // the shown variant, loaded tiles only
    expect(n.grid?.id).toBe('grid');
    expect(ids(n.gridLabels)).toEqual(['label-a']);
    expect(ids(n.vectors)).toEqual(['elements']);
    expect(ids(n.markers)).toEqual(['marker']);
    expect(ids(n.texts)).toEqual(['text']);
    const all = [...n.placeholder, ...n.tiles, ...n.vectors, ...n.markers, ...n.texts].map(
      (e) => e.id,
    );
    for (const excluded of ['laser', 'cursor', 'selection', 'draft', 'pulse'])
      expect(all).not.toContain(excluded);
    const clean = selectExportNodes(container, 'clean', false);
    expect(ids(clean.tiles)).toEqual(['t-clean']);
    expect(clean.grid).toBeNull();
    expect(clean.gridLabels).toEqual([]);
  });

  it('filename {room-slug}_{board-slug}_{YYYY-MM-DD}.png and the footer line', () => {
    const date = new Date(2026, 9, 26, 15, 0);
    expect(exportFileName('Team Soul', 'Erangel – Plan A', date)).toBe(
      'team-soul_erangel-plan-a_2026-10-26.png',
    );
    expect(slug('Ünïcödé  !!')).toBe('unicode');
    expect(slug('🎯')).toBe('board');
    const f = footerText({
      room: 'Team Soul',
      board: 'Plan A',
      map: 'Erangel',
      date,
      credit: 'PUBG map imagery © KRAFTON',
    });
    expect(f.startsWith('Team Soul · Plan A · Erangel · ')).toBe(true);
    expect(f.endsWith(' · PUBG map imagery © KRAFTON')).toBe(true);
  });
});

// ---- measure tool ---------------------------------------------------------------------------

describe('MeasureTool (FEATURES F11)', () => {
  let line: MeasureLine | null = null;
  const ctx = {
    worldPerPx: () => 100,
    setMeasure: (l: MeasureLine | null) => {
      line = l;
    },
    setDraft: () => undefined,
    preview: { begin() {}, append() {}, replace() {}, end() {} },
  } as unknown as ToolContext;
  const p = (x: number, y: number): ToolPointer => ({
    world: [x, y],
    screen: [x / 100, y / 100],
    shiftKey: false,
    button: 0,
  });
  beforeEach(() => {
    line = null;
  });

  it('click points, rubber band, double-click finishes; the line stays until Esc', () => {
    const t = new MeasureTool(ctx);
    t.onPointerDown(p(0, 0));
    t.onPointerMove(p(30_000, 0));
    expect(line).toEqual({ points: [[0, 0]], hover: [30_000, 0], finished: false });
    t.onPointerDown(p(30_000, 0));
    t.onPointerDown(p(30_000, 40_000));
    t.onDoubleClick();
    expect(line).toMatchObject({
      points: [
        [0, 0],
        [30_000, 0],
        [30_000, 40_000],
      ],
      finished: true,
      hover: null,
    });
    t.onPointerMove(p(1, 1)); // no rubber band once finished
    expect(line?.hover).toBeNull();
    expect(t.onKeyDown({ key: 'Escape', shiftKey: false })).toBe(true);
    expect(line).toBeNull();
  });

  it('Backspace removes the last point, Enter finishes, a click after finishing starts anew', () => {
    const t = new MeasureTool(ctx);
    t.onPointerDown(p(0, 0));
    t.onPointerDown(p(10_000, 0));
    t.onPointerDown(p(20_000, 0));
    t.onKeyDown({ key: 'Backspace', shiftKey: false });
    expect(line?.points).toEqual([
      [0, 0],
      [10_000, 0],
    ]);
    t.onKeyDown({ key: 'Enter', shiftKey: false });
    expect(line?.finished).toBe(true);
    t.onPointerDown(p(5, 5));
    expect(line).toEqual({ points: [[5, 5]], hover: null, finished: false });
  });

  it('a double-click’s second press doesn’t add a duplicate point', () => {
    const t = new MeasureTool(ctx);
    t.onPointerDown(p(0, 0));
    t.onPointerDown(p(100, 100)); // < 3 px away at 100 world / px
    expect(line?.points).toEqual([[0, 0]]);
  });
});

// ---- zone presets plumbing (still empty in ZONE_PRESETS: TODO(phase0)) -----------------------

describe('zone presets in the style bar (DRAW-8)', () => {
  const renderBar = (presets?: { label: string; radiusMetres: number }[]) =>
    render(
      <StyleBar
        role="EDITOR"
        mapId="erangel"
        session={null}
        nameOf={() => 'x'}
        {...(presets ? { presets } : {})}
      />,
    );
  beforeEach(() => {
    useToolStore.setState({ tool: 'circle', presetRadius: null });
  });

  it('hidden while the map has none (the shipped state)', () => {
    renderBar();
    expect(screen.queryByText('Zone presets')).toBeNull();
  });

  it('injected presets show the dropdown; picking one arms its radius in world units', () => {
    renderBar([{ label: 'Phase 1', radiusMetres: 2_500 }]);
    const trigger = screen.getByText('Zone presets');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(screen.getByText('Phase 1 · 2500 m'));
    expect(useToolStore.getState().presetRadius).toBe(250_000);
  });
});

describe('account deletion default per room', () => {
  const m = (id: string, role: 'EDITOR' | 'VIEWER', joinedAt: string) => ({
    user: { id, username: id, displayName: id, ign: null, avatarColor: '#38BDF8' },
    role,
    joinedAt,
    online: false,
  });
  it('pre-selects the longest-standing editor, like the server fallback; else delete', () => {
    expect(
      defaultChoice(
        [
          m('me', 'EDITOR', '2026-01-01'),
          m('v', 'VIEWER', '2026-01-02'),
          m('e2', 'EDITOR', '2026-03-01'),
          m('e1', 'EDITOR', '2026-02-01'),
        ],
        'me',
      ),
    ).toBe('e1');
    expect(defaultChoice([m('v', 'VIEWER', '2026-01-02')], 'me')).toBe('delete');
  });
});
