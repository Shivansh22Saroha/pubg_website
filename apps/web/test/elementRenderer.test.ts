import type { Layer } from '@rotationlab/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ElementRenderer,
  MAX_ENTERING,
  type LeafletApi,
  type MapLike,
} from '@/components/map/elementRenderer';
import { cursorElement, markerElement, safeColor, textElement } from '@/components/map/markerDom';
import type { ViewElement } from '@/stores/boardModel';

/** Minimal fake Leaflet: records constructions and map add/remove calls. */
class FakeLayer {
  static made = 0;
  fronted = 0;
  constructor(
    readonly kind: string,
    readonly args: unknown[],
  ) {
    FakeLayer.made++;
  }
  bringToFront() {
    this.fronted++;
  }
}
const make =
  (kind: string) =>
  (...args: unknown[]) =>
    new FakeLayer(kind, args) as never;
const fakeL: LeafletApi = {
  polyline: make('polyline'),
  polygon: make('polygon'),
  circle: make('circle'),
  marker: make('marker'),
  divIcon: ((o: unknown) => ({ divIcon: o })) as never,
  featureGroup: make('featureGroup'),
};

class FakeMap implements MapLike {
  onMap = new Set<unknown>();
  adds = 0;
  removes = 0;
  addLayer(l: unknown) {
    this.adds++;
    this.onMap.add(l);
  }
  removeLayer(l: unknown) {
    this.removes++;
    this.onMap.delete(l);
  }
  getZoom() {
    return 2;
  }
}

const L1 = 'layer-1';
const L2 = 'layer-2';
const layers = (visible2 = true, swap = false): Layer[] => [
  {
    id: L1,
    boardId: 'b',
    name: 'A',
    color: '#F2A900',
    position: swap ? 1 : 0,
    visible: true,
    locked: false,
    seq: 0,
  },
  {
    id: L2,
    boardId: 'b',
    name: 'B',
    color: '#EF4444',
    position: swap ? 0 : 1,
    visible: visible2,
    locked: false,
    seq: 0,
  },
];
const el = (
  id: string,
  type: ViewElement['type'],
  layerId = L1,
  over: Partial<ViewElement> = {},
): ViewElement => ({
  id,
  boardId: 'b',
  layerId,
  type,
  geometry:
    type === 'CIRCLE'
      ? { center: [100, 100], r: 500 }
      : type === 'TEXT' || type === 'MARKER'
        ? { at: [5, 5] }
        : {
            points: [
              [0, 0],
              [10, 10],
              [20, 0],
            ],
          },
  style: { color: '#F2A900', width: 4, dashed: false, fillOpacity: 0.1 },
  props:
    type === 'TEXT'
      ? { text: 'hi', size: 'md' }
      : type === 'MARKER'
        ? { kind: 'enemy_squad', number: 3 }
        : {},
  z: 0,
  seq: 1,
  createdBy: null,
  updatedBy: null,
  updatedAt: '2026-10-25T00:00:00.000Z',
  ...over,
});

let map: FakeMap;
let r: ElementRenderer;
beforeEach(() => {
  map = new FakeMap();
  r = new ElementRenderer(fakeL, map, {} as never, 816_000);
  FakeLayer.made = 0;
});

describe('double-headed arrows (Phase 11)', () => {
  it('draw a second head, from the reversed path, only when props.doubleHeaded', () => {
    r.sync(
      { one: el('one', 'ARROW'), two: el('two', 'ARROW', L1, { props: { doubleHeaded: true } }) },
      layers(),
    );
    const groups = [...map.onMap] as FakeLayer[];
    const parts = groups.map((g) => (g.args[0] as FakeLayer[]).map((x) => x.kind));
    expect(parts).toContainEqual(['polyline', 'polygon']);
    expect(parts).toContainEqual(['polyline', 'polygon', 'polygon']);
    const two = groups.find((g) => (g.args[0] as unknown[]).length === 3);
    const heads = (two?.args[0] as FakeLayer[]).slice(1).map((h) => (h.args[0] as number[][])[0]);
    // tips at the last point [20, 0] and the first point [0, 0] (LatLng = [y, x])
    expect(heads).toEqual([
      [0, 20],
      [0, 0],
    ]);
  });
});

describe('curved arrows (Phase 12)', () => {
  it('draw the sampled curve, not the stored bends', () => {
    r.sync(
      {
        straight: el('straight', 'ARROW'),
        curved: el('curved', 'ARROW', L1, { props: { curved: true } }),
      },
      layers(),
    );
    const lines = ([...map.onMap] as FakeLayer[]).map(
      (g) => ((g.args[0] as FakeLayer[])[0]?.args[0] as unknown[]).length,
    );
    expect(lines.sort((x, y) => x - y)).toEqual([3, 33]); // 3 stored points; 2 bends × 16 + 1
  });
});

describe('loot markers (Phase 12)', () => {
  const url = (id: string) => `/tiles/icons/items/${id}.webp`;

  it('put the item icon (from the allow-listed id) over the crate; it drops out if it fails', () => {
    const m = markerElement({ kind: 'loot', item: 'awm' }, '#A855F7', url);
    const icon = m.querySelector<HTMLImageElement>('img.rl-loot-icon');
    expect(icon?.getAttribute('src')).toBe('/tiles/icons/items/awm.webp');
    expect(icon?.crossOrigin).toBe('anonymous');
    expect(m.querySelector('svg rect')).not.toBeNull(); // the crate badge stays underneath
    icon?.dispatchEvent(new Event('error'));
    expect(m.querySelector('img')).toBeNull();
    expect(m.querySelector('[data-loot-crate]')).not.toBeNull(); // failed: the crate shows
  });

  it('a loaded icon replaces the crate lines (the badge stays)', () => {
    const m = markerElement({ kind: 'loot', item: 'awm' }, '#A855F7', url);
    m.querySelector('img')?.dispatchEvent(new Event('load'));
    expect(m.querySelector('[data-loot-crate]')).toBeNull();
    expect(m.querySelector('svg rect')).not.toBeNull();
  });

  it('no icon without an item or a URL for it', () => {
    expect(markerElement({ kind: 'loot' }, '#A855F7', url).querySelector('img')).toBeNull();
    expect(markerElement({ kind: 'loot', item: 'awm' }, '#A855F7').querySelector('img')).toBeNull();
    expect(
      markerElement({ kind: 'loot', item: 'awm' }, '#A855F7', () => null).querySelector('img'),
    ).toBeNull();
  });

  it('the renderer only builds URLs for registry ids, under its icon base', () => {
    const withBase = new ElementRenderer(fakeL, map, {} as never, 816_000, '/tiles');
    withBase.sync(
      {
        ok: el('ok', 'MARKER', L1, { props: { kind: 'loot', item: 'awm' } }),
        bad: el('bad', 'MARKER', L1, { props: { kind: 'loot', item: 'x/../../y' } }),
      },
      layers(),
    );
    const srcs = ([...map.onMap] as FakeLayer[])
      .map((m) => (m.args[1] as { icon: { divIcon: { html: HTMLElement } } }).icon.divIcon.html)
      .map((h) => h.querySelector('img')?.getAttribute('src') ?? null);
    expect(srcs.sort()).toEqual(['/tiles/icons/items/awm.webp', null].sort());
  });
});

describe('ElementRenderer diffing', () => {
  it('creates one Leaflet layer per element and renders every type', () => {
    const els = Object.fromEntries(
      (['STROKE', 'LINE', 'ARROW', 'CIRCLE', 'POLYGON', 'TEXT', 'MARKER'] as const).map((t, i) => [
        `e${i}`,
        el(`e${i}`, t),
      ]),
    );
    const stats = r.sync(els, layers());
    expect(stats.created).toBe(7);
    expect(map.onMap.size).toBe(7);
    const kinds = [...map.onMap].map((l) => (l as FakeLayer).kind).sort();
    expect(kinds).toEqual([
      'circle',
      'featureGroup',
      'marker',
      'marker',
      'polygon',
      'polyline',
      'polyline',
    ]);
  });

  it('touches nothing when the same objects are synced again', () => {
    const els = { a: el('a', 'LINE'), b: el('b', 'CIRCLE') };
    r.sync(els, layers());
    const adds = map.adds;
    const made = FakeLayer.made;
    const stats = r.sync({ ...els }, layers());
    expect(stats).toMatchObject({ created: 0, replaced: 0, removed: 0 });
    expect(map.adds).toBe(adds);
    expect(FakeLayer.made).toBe(made);
  });

  it('replaces only the changed element and removes deleted ones', () => {
    const a = el('a', 'LINE');
    const b = el('b', 'LINE');
    r.sync({ a, b }, layers());
    const stats = r.sync({ a, b: { ...b, seq: 2, style: { ...b.style, width: 7 } } }, layers());
    expect(stats).toMatchObject({ created: 0, replaced: 1, removed: 0 });
    const gone = r.sync({ a }, layers());
    expect(gone.removed).toBe(1);
    expect(map.onMap.size).toBe(1);
  });

  it('hides elements on hidden layers without dropping them, and shows them again', () => {
    const els = { a: el('a', 'LINE', L1), b: el('b', 'LINE', L2) };
    r.sync(els, layers());
    r.sync(els, layers(false));
    expect(map.onMap.size).toBe(1);
    expect(r.size).toBe(2);
    r.sync(els, layers(true));
    expect(map.onMap.size).toBe(2);
  });

  it('only re-stacks new tail elements; a layer reorder re-stacks everything', () => {
    const a = el('a', 'LINE', L1);
    const b = el('b', 'LINE', L2);
    r.sync({ a, b }, layers());
    const c = el('c', 'LINE', L2, { z: 5 }); // sorts last
    const stats = r.sync({ a, b, c }, layers());
    expect(stats.reordered).toBe(false);
    const swapped = r.sync({ a, b, c }, layers(true, true));
    expect(swapped.reordered).toBe(true);
  });
});

describe('marker DOM (SECURITY V4/V5)', () => {
  it('puts user text in text nodes, never markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const m = markerElement({ kind: 'enemy_squad', number: 7, label: evil }, '#EF4444');
    expect(m.querySelector('img')).toBeNull();
    expect(m.textContent).toContain(evil.slice(0, 24));
    const t = textElement({ text: evil, size: 'lg' }, '#F8FAFC');
    expect(t.querySelector('img')).toBeNull();
    expect(t.textContent).toBe(evil);
    const c = cursorElement(evil, '#38BDF8');
    expect(c.querySelector('img')).toBeNull();
  });

  it('only lets #RRGGBB colours reach SVG/CSS', () => {
    expect(safeColor('#22c55e')).toBe('#22c55e');
    for (const bad of [
      'red',
      'url(javascript:x)',
      '#fff',
      '#12345g',
      '#123456;fill:red',
      42,
      undefined,
    ]) {
      expect(safeColor(bad)).toBe('#F8FAFC');
    }
    const m = markerElement({ kind: 'pin' }, 'url(javascript:alert(1))');
    expect(m.innerHTML).not.toContain('javascript');
  });

  it('falls back to a pin for unknown marker kinds and caps labels at 24 chars', () => {
    const m = markerElement({ kind: 'nuke', label: 'x'.repeat(40) }, '#EF4444');
    expect(m.querySelector('svg path')).not.toBeNull();
    expect(m.querySelector('.rl-marker-label')?.textContent).toHaveLength(24);
  });
});

describe('entrance motion (motion library)', () => {
  const on = { animate: true, meId: 'me' };
  const iconClass = (l: FakeLayer) =>
    (l.args[1] as { icon: { divIcon: { className: string } } }).icon.divIcon.className;

  it("animates other people's new vectors; never my own, never with animate off", () => {
    r.sync({}, layers(), on);
    const s = r.sync(
      {
        theirs: el('theirs', 'LINE', L1, { createdBy: 'rudra' }),
        mine: el('mine', 'CIRCLE', L1, { createdBy: 'me' }),
      },
      layers(),
      on,
    );
    expect(s.entered.map((e) => e.el.id)).toEqual(['theirs']);
    const off = r.sync({ x: el('x', 'POLYGON', L1, { createdBy: 'rudra' }) }, layers());
    expect(off.entered).toEqual([]);
  });

  it('skips bulk loads above MAX_ENTERING and replaced (edited) elements', () => {
    const many: Record<string, ViewElement> = {};
    for (let i = 0; i <= MAX_ENTERING; i++) many[`e${i}`] = el(`e${i}`, 'LINE');
    expect(r.sync(many, layers(), on).entered).toEqual([]);
    const edited = { ...many, e0: el('e0', 'LINE', L1, { seq: 2, z: 5 }) };
    expect(r.sync(edited, layers(), on).entered).toEqual([]);
  });

  it('a server ack that only bumps seq keeps the layer (the entrance plays on)', () => {
    r.sync({}, layers(), on);
    r.sync({ m: el('m', 'MARKER') }, layers(), on);
    const before = [...map.onMap];
    const s = r.sync(
      { m: el('m', 'MARKER', L1, { seq: 9, updatedAt: '2026-11-05T00:00:00.000Z' }) },
      layers(),
      on,
    );
    expect(s).toMatchObject({ created: 0, replaced: 0 });
    expect([...map.onMap]).toEqual(before);
    expect(iconClass(before[0] as FakeLayer)).toContain('rl-enter-alert');
  });

  it('does not report elements that land on a hidden layer', () => {
    expect(r.sync({ h: el('h', 'LINE', L2) }, layers(false), on).entered).toEqual([]);
  });

  it('gives new markers an entrance class by kind (drop, enemy alert, pop)', () => {
    r.sync(
      {
        d: el('d', 'MARKER', L1, { props: { kind: 'drop' } }),
        e: el('e', 'MARKER', L1, { props: { kind: 'enemy_squad', number: 2 } }),
        v: el('v', 'MARKER', L1, { props: { kind: 'vehicle' } }),
      },
      layers(),
      on,
    );
    const classes = ([...map.onMap] as FakeLayer[]).map(iconClass).sort();
    expect(classes).toEqual([
      'rl-marker-icon rl-enter rl-enter-alert',
      'rl-marker-icon rl-enter rl-enter-drop',
      'rl-marker-icon rl-enter rl-enter-pop',
    ]);
  });
});
