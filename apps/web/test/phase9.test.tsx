import type { DemoBoard } from '@rotationlab/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tourReducer, placeCard, TOUR_STEPS, type TourState } from '@/components/room/tourModel';
import { elementLabel } from '@/components/tools/ElementList';
import { toolsFor } from '@/components/tools/gating';
import { PHONE_PRIMARY, Toolbar } from '@/components/tools/Toolbar';
import { breakpointFor, isLandscapePhone, isTouchLayout } from '@/hooks/useBreakpoint';
import { exploreBoards } from '@/lib/explore';
import { securityTxt } from '@/lib/securityTxt';
import { devPagesEnabled, serverEnv } from '@/lib/serverEnv';

describe('breakpoints (UI_UX_SPEC §7)', () => {
  it('desktop ≥ 1280, compact 1024–1279, tablet 768–1023, phone < 768', () => {
    expect([1920, 1280, 1279, 1024, 1023, 768, 767, 390, 360].map((w) => breakpointFor(w))).toEqual(
      ['desktop', 'desktop', 'compact', 'compact', 'tablet', 'tablet', 'phone', 'phone', 'phone'],
    );
    expect(isTouchLayout('tablet') && isTouchLayout('phone')).toBe(true);
    expect(isTouchLayout('compact') || isTouchLayout('desktop')).toBe(false);
  });

  it('a phone held sideways is a phone, even 800–930 px wide (touch, under 520 px tall)', () => {
    expect(breakpointFor(844, 390, true)).toBe('phone'); // iPhone 13 landscape
    expect(breakpointFor(932, 430, true)).toBe('phone'); // iPhone Pro Max landscape
    expect(breakpointFor(844, 390, false)).toBe('tablet'); // a short desktop window: mouse
    expect(breakpointFor(1024, 768, true)).toBe('compact'); // iPad landscape is not a phone
    expect(breakpointFor(390, 844, true)).toBe('phone');
    expect(isLandscapePhone(844, 390, true)).toBe(true);
    expect(isLandscapePhone(390, 844, true)).toBe(false); // portrait
  });

  it('tool sets per breakpoint and role', () => {
    const all = toolsFor('EDITOR', 'desktop');
    expect(toolsFor('EDITOR', 'compact')).toEqual(all);
    expect(toolsFor('EDITOR', 'tablet')).toEqual(all); // full set, touch-drawn
    // since 2026-11 phones draw too: the full set (six in the bar, the rest under More)
    expect(toolsFor('EDITOR', 'phone')).toEqual(all);
    expect(toolsFor('OWNER', 'phone')).toEqual(all);
    // phones never add a tool the role lacks: viewers keep Select, Measure, Laser
    expect(toolsFor('VIEWER', 'phone')).toEqual(['select', 'measure', 'laser']);
    expect(toolsFor('VIEWER', 'desktop')).toEqual(['select', 'measure', 'laser']);
  });

  it('a phone bar: six tools, the rest under More tools, undo / redo moved to the top bar', () => {
    render(
      <Toolbar
        role="EDITOR"
        session={null}
        nameOf={() => ''}
        breakpoint="phone"
        orientation="horizontal"
        compact
      />,
    );
    const bar = screen.getByTestId('toolbar');
    expect(bar.dataset.orientation).toBe('horizontal');
    for (const id of PHONE_PRIMARY) expect(screen.getByTestId(`tool-${id}`)).toBeTruthy();
    for (const id of ['line', 'polygon', 'text', 'measure', 'laser'])
      expect(screen.queryByTestId(`tool-${id}`)).toBeNull(); // behind More (opens on tap)
    expect(screen.getByTestId('tools-more')).toBeTruthy();
    expect(screen.queryByTestId('undo')).toBeNull();
  });

  it('viewers on a phone: their three tools fit, no More button', () => {
    cleanup();
    render(<Toolbar role="VIEWER" session={null} nameOf={() => ''} breakpoint="phone" compact />);
    for (const id of ['select', 'measure', 'laser'])
      expect(screen.getByTestId(`tool-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('tools-more')).toBeNull();
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
