import type { DemoBoard } from '@rotationlab/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tourReducer, placeCard, TOUR_STEPS, type TourState } from '@/components/room/tourModel';
import { elementLabel } from '@/components/tools/ElementList';
import { PHONE_TOOLS, toolsFor } from '@/components/tools/gating';
import { Toolbar } from '@/components/tools/Toolbar';
import { breakpointFor, isTouchLayout } from '@/hooks/useBreakpoint';
import { exploreBoards } from '@/lib/explore';
import { securityTxt } from '@/lib/securityTxt';
import { devPagesEnabled, serverEnv } from '@/lib/serverEnv';

describe('breakpoints (UI_UX_SPEC §7)', () => {
  it('desktop ≥ 1280, compact 1024–1279, tablet 768–1023, phone < 768', () => {
    expect([1920, 1280, 1279, 1024, 1023, 768, 767, 390, 360].map(breakpointFor)).toEqual([
      'desktop',
      'desktop',
      'compact',
      'compact',
      'tablet',
      'tablet',
      'phone',
      'phone',
      'phone',
    ]);
    expect(isTouchLayout('tablet') && isTouchLayout('phone')).toBe(true);
    expect(isTouchLayout('compact') || isTouchLayout('desktop')).toBe(false);
  });

  it('tool sets per breakpoint and role', () => {
    const all = toolsFor('EDITOR', 'desktop');
    expect(toolsFor('EDITOR', 'compact')).toEqual(all);
    expect(toolsFor('EDITOR', 'tablet')).toEqual(all); // full set, touch-drawn
    expect(toolsFor('EDITOR', 'phone')).toEqual(['select', 'marker', 'measure', 'laser']);
    expect(toolsFor('OWNER', 'phone')).toEqual(['select', 'marker', 'measure', 'laser']);
    // phones never add a tool the role lacks: viewers keep Select, Measure, Laser
    expect(toolsFor('VIEWER', 'phone')).toEqual(['select', 'measure', 'laser']);
    expect(toolsFor('VIEWER', 'desktop')).toEqual(['select', 'measure', 'laser']);
    for (const t of toolsFor('EDITOR', 'phone')) expect(PHONE_TOOLS).toContain(t);
  });

  it('the toolbar renders only those tools, horizontally on touch layouts', () => {
    render(
      <Toolbar
        role="EDITOR"
        session={null}
        nameOf={() => ''}
        breakpoint="phone"
        orientation="horizontal"
      />,
    );
    const bar = screen.getByTestId('toolbar');
    expect(bar.dataset.orientation).toBe('horizontal');
    expect(screen.queryByTestId('tool-pen')).toBeNull();
    expect(screen.queryByTestId('tool-eraser')).toBeNull();
    for (const id of ['select', 'marker', 'measure', 'laser'])
      expect(screen.getByTestId(`tool-${id}`)).toBeTruthy();
    expect(screen.getByTestId('undo')).toBeTruthy(); // editors keep undo / redo
  });
});

describe('room tour (UF-3 step 4)', () => {
  const all = new Set(['toolbar', 'board-tabs', 'invite'] as const);

  it('three steps in order; Next ends it on the last; Back stays ≥ 0', () => {
    let s: TourState = tourReducer({ status: 'idle' }, { type: 'start', available: all });
    expect(s).toMatchObject({ status: 'running', index: 0 });
    if (s.status !== 'running') throw new Error('not running');
    expect(s.steps.map((x) => x.anchor)).toEqual(['toolbar', 'board-tabs', 'invite']);
    s = tourReducer(s, { type: 'back' });
    expect(s).toMatchObject({ index: 0 });
    s = tourReducer(tourReducer(s, { type: 'next' }), { type: 'next' });
    expect(s).toMatchObject({ index: 2 });
    s = tourReducer(s, { type: 'back' });
    expect(s).toMatchObject({ index: 1 });
    s = tourReducer(tourReducer(s, { type: 'next' }), { type: 'next' });
    expect(s).toEqual({ status: 'done' });
  });

  it('dismiss ends it; missing anchors are skipped (a viewer has no Invite); done stays done', () => {
    const running = tourReducer({ status: 'idle' }, { type: 'start', available: all });
    expect(tourReducer(running, { type: 'dismiss' })).toEqual({ status: 'done' });
    const viewer = tourReducer(
      { status: 'idle' },
      { type: 'start', available: new Set(['toolbar', 'board-tabs'] as const) },
    );
    expect(viewer.status === 'running' && viewer.steps.length).toBe(2);
    expect(tourReducer({ status: 'idle' }, { type: 'start', available: new Set() })).toEqual({
      status: 'done',
    });
    const done: TourState = { status: 'done' };
    expect(tourReducer(done, { type: 'start', available: all })).toBe(done);
    expect(tourReducer(done, { type: 'next' })).toBe(done);
    expect(TOUR_STEPS).toHaveLength(3);
  });

  it('places the card below, above, or beside a tall anchor — inside the viewport', () => {
    const vp = { width: 1280, height: 720 };
    const card = { width: 288, height: 160 };
    // board tabs at the top → below
    expect(placeCard({ top: 0, left: 100, width: 400, height: 48 }, card, vp)).toEqual({
      top: 60,
      left: 100,
    });
    // a bottom toolbar → above
    expect(placeCard({ top: 664, left: 0, width: 390, height: 56 }, card, vp).top).toBe(492);
    // the left toolbar column → to its right
    expect(placeCard({ top: 48, left: 0, width: 56, height: 672 }, card, vp)).toEqual({
      top: 56,
      left: 68,
    });
    // an Invite button at the right edge → clamped
    expect(placeCard({ top: 8, left: 1200, width: 70, height: 32 }, card, vp).left).toBe(
      1280 - 288 - 8,
    );
  });
});

const demo = (mapId: DemoBoard['board']['mapId'], name: string): DemoBoard => ({
  board: {
    id: crypto.randomUUID(),
    name,
    mapId,
    position: 0,
    elementCount: 1,
    updatedAt: '2026-10-26T00:00:00.000Z',
  },
  layers: [],
  elements: [],
});

describe('explore boards (FEATURES F13)', () => {
  it('one per map in map order: the first demo board of each, else the bare map', () => {
    const out = exploreBoards([
      demo('rondo', 'Rondo demo'),
      demo('erangel', 'Erangel demo'),
      demo('erangel', 'Second Erangel'),
    ]);
    expect(out.map((b) => [b.mapId, b.name])).toEqual([
      ['erangel', 'Erangel demo'],
      ['miramar', ''],
      ['rondo', 'Rondo demo'],
    ]);
    expect(exploreBoards([]).map((b) => b.mapId)).toEqual(['erangel', 'miramar', 'rondo']);
    expect(exploreBoards([]).every((b) => Object.keys(b.elements).length === 0)).toBe(true);
  });
});

describe('ENABLE_DEV_PAGES (TODO Phase 9)', () => {
  it('off in production unless "true"; on elsewhere unless "false"', () => {
    expect(devPagesEnabled(serverEnv({ NODE_ENV: 'production' }))).toBe(false);
    expect(devPagesEnabled(serverEnv({ NODE_ENV: 'production', ENABLE_DEV_PAGES: '' }))).toBe(
      false,
    );
    expect(devPagesEnabled(serverEnv({ NODE_ENV: 'production', ENABLE_DEV_PAGES: 'true' }))).toBe(
      true,
    );
    expect(devPagesEnabled(serverEnv({ NODE_ENV: 'development' }))).toBe(true);
    expect(devPagesEnabled(serverEnv({ NODE_ENV: 'development', ENABLE_DEV_PAGES: 'false' }))).toBe(
      false,
    );
    // never z.coerce.boolean(): anything but true/false is a config error
    expect(() => serverEnv({ NODE_ENV: 'production', ENABLE_DEV_PAGES: 'yes' })).toThrow();
  });
});

describe('security.txt (SECURITY §13)', () => {
  it('contact from env, an RFC 9116 Expires a year out, canonical URL', () => {
    const txt = securityTxt(
      'mailto:security@example.com',
      'https://app.example/',
      new Date('2026-10-26T12:00:00Z'),
    );
    expect(txt).toContain('Contact: mailto:security@example.com\n');
    expect(txt).toContain('Expires: 2027-10-26T00:00:00.000Z\n');
    expect(txt).toContain('Canonical: https://app.example/.well-known/security.txt\n');
    expect(() => serverEnv({ NODE_ENV: 'production', SECURITY_CONTACT: 'bob' })).toThrow();
    expect(serverEnv({ NODE_ENV: 'production', SECURITY_CONTACT: '' }).SECURITY_CONTACT).toBe(
      undefined,
    );
  });
});

describe('element list labels (UI_UX_SPEC §10)', () => {
  it('text, marker kind + number + label, nothing for shapes', () => {
    expect(elementLabel({ type: 'TEXT', props: { text: 'Hold here', size: 'md' } })).toBe(
      'Hold here',
    );
    expect(elementLabel({ type: 'MARKER', props: { kind: 'enemy_squad', number: 3 } })).toBe(
      'Enemy squad 3',
    );
    expect(elementLabel({ type: 'MARKER', props: { kind: 'drop', label: 'Pochinki' } })).toBe(
      'Drop Pochinki',
    );
    expect(elementLabel({ type: 'ARROW', props: {} })).toBe('');
  });
});
