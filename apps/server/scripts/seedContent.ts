import type { DEFAULT_LAYERS } from '@rotationlab/shared';
import {
  ElementInputSchema,
  MAPS,
  elementWithinWorld,
  type ElementInput,
  type MapId,
} from '@rotationlab/shared';

/**
 * Sample tactical content for seeded and demo boards (DATABASE_SCHEMA §7): a drop marker,
 * rotation arrows, a zone circle and a few enemy squads, placed as fractions of each map so
 * the same template works on every map. Pure, so a unit test can check it against the
 * element schemas and the map bounds.
 */

type Frac = readonly [number, number];
interface Template {
  drop: Frac;
  route: readonly Frac[];
  zone: { center: Frac; r: number };
  enemies: readonly Frac[];
  note: { at: Frac; text: string };
}

const TEMPLATES: Record<MapId, Template> = {
  erangel: {
    drop: [0.42, 0.56],
    route: [
      [0.43, 0.54],
      [0.5, 0.48],
      [0.56, 0.41],
    ],
    zone: { center: [0.57, 0.4], r: 0.085 },
    enemies: [
      [0.47, 0.61],
      [0.62, 0.46],
      [0.51, 0.35],
    ],
    note: { at: [0.5, 0.45], text: 'Rotate after the 2nd zone' },
  },
  miramar: {
    drop: [0.48, 0.62],
    route: [
      [0.49, 0.6],
      [0.55, 0.52],
      [0.53, 0.42],
    ],
    zone: { center: [0.52, 0.41], r: 0.09 },
    enemies: [
      [0.44, 0.55],
      [0.6, 0.5],
      [0.57, 0.36],
    ],
    note: { at: [0.57, 0.56], text: 'Vehicle on the road' },
  },
  rondo: {
    drop: [0.36, 0.44],
    route: [
      [0.38, 0.45],
      [0.46, 0.5],
      [0.54, 0.55],
    ],
    zone: { center: [0.55, 0.56], r: 0.08 },
    enemies: [
      [0.41, 0.38],
      [0.5, 0.6],
      [0.63, 0.52],
    ],
    note: { at: [0.45, 0.56], text: 'Hold the ridge' },
  },
};

export interface SeedLayer {
  id: string;
  name: string;
}

export function demoElements(
  mapId: MapId,
  layers: readonly SeedLayer[],
  newId: () => string,
  boardId: string,
): ElementInput[] {
  const t = TEMPLATES[mapId];
  const w = MAPS[mapId].worldSize;
  const pt = ([fx, fy]: Frac) => [Math.round(fx * w), Math.round(fy * w)] as [number, number];
  const layer = (name: (typeof DEFAULT_LAYERS)[number]['name']) => {
    const l = layers.find((x) => x.name === name);
    if (!l) throw new Error(`no ${name} layer`);
    return l.id;
  };
  const plan = layer('Plan');
  const enemies = layer('Enemies');
  const zones = layer('Zones');
  const base = (layerId: string, color: string) => ({
    id: newId(),
    boardId,
    layerId,
    z: 0,
    style: { color, width: 4 as const, dashed: false, fillOpacity: 0 },
  });

  const raw: unknown[] = [
    {
      ...base(zones, '#F8FAFC'),
      type: 'CIRCLE',
      geometry: { center: pt(t.zone.center), r: Math.round(t.zone.r * w) },
      style: { color: '#F8FAFC', width: 2, dashed: true, fillOpacity: 0 },
      props: {},
    },
    { ...base(plan, '#F2A900'), type: 'ARROW', geometry: { points: t.route.map(pt) }, props: {} },
    {
      ...base(plan, '#F2A900'),
      type: 'MARKER',
      geometry: { at: pt(t.drop) },
      props: { kind: 'drop', label: 'Drop' },
    },
    {
      ...base(plan, '#38BDF8'),
      type: 'MARKER',
      geometry: { at: pt(t.route.at(-1) ?? t.drop) },
      props: { kind: 'own_squad', label: 'US' },
    },
    ...t.enemies.map((at, i) => ({
      ...base(enemies, '#EF4444'),
      type: 'MARKER',
      geometry: { at: pt(at) },
      props: { kind: 'enemy_squad', number: i + 1 },
    })),
    {
      ...base(plan, '#F8FAFC'),
      type: 'TEXT',
      geometry: { at: pt(t.note.at) },
      props: { text: t.note.text, size: 'md' },
    },
  ];
  return raw.map((r) => {
    const el = ElementInputSchema.parse(r);
    if (!elementWithinWorld(el, w)) throw new Error(`${mapId}: element outside the map`);
    return el;
  });
}
