import { z } from 'zod';
import { HexColorSchema, textField } from '../text.js';

/**
 * Element model (DATABASE_SCHEMA §4). Geometry is in PUBG world units (cm), integers.
 * The schemas enforce shape and the SECURITY V2 limits; bounds against the *board's* map
 * (0…worldSize) are checked by `elementWithinWorld` once the server knows the map.
 */

export const ELEMENT_LIMITS = {
  maxCoord: 1_000_000, // generous absolute cap; the real per-map bound is checked server-side
  strokePoints: 2000,
  arrowPoints: 50,
  polygonPoints: 200,
  circleRadiusMin: 100,
  circleRadiusMax: 600_000,
  textMax: 120,
  markerLabelMax: 24,
  markerNumberMax: 25,
  elementJsonBytes: 64 * 1024,
  maxElementsPerBoard: 5000,
  batchOps: 50,
  messageBytes: 64 * 1024,
} as const;

export const ELEMENT_TYPES = [
  'STROKE',
  'LINE',
  'ARROW',
  'CIRCLE',
  'POLYGON',
  'TEXT',
  'MARKER',
] as const;
export const ElementTypeSchema = z.enum(ELEMENT_TYPES);
export type ElementType = z.infer<typeof ElementTypeSchema>;

const Coord = z.number().int().min(0).max(ELEMENT_LIMITS.maxCoord);
export const PtSchema = z.tuple([Coord, Coord]);
const points = (min: number, max: number) => z.array(PtSchema).min(min).max(max);

export const StyleSchema = z.strictObject({
  color: HexColorSchema,
  width: z.union([z.literal(2), z.literal(4), z.literal(7)]),
  dashed: z.boolean(),
  fillOpacity: z.number().min(0).max(0.6),
});
export type Style = z.infer<typeof StyleSchema>;

export const MARKER_KINDS = [
  'own_squad',
  'own_player',
  'enemy_squad',
  'vehicle',
  'drop',
  'danger',
  'hold',
  'pin',
] as const;

const empty = z.strictObject({}).default({});

const common = {
  id: z.uuid(),
  boardId: z.uuid(),
  layerId: z.uuid(),
  style: StyleSchema,
  z: z.number().int().min(-1_000_000).max(1_000_000).default(0),
};

/** What a client sends (API_SPEC §7.2): Element without seq/createdBy/updatedBy/updatedAt. */
export const ElementInputSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...common,
    type: z.literal('STROKE'),
    geometry: z.strictObject({ points: points(2, ELEMENT_LIMITS.strokePoints) }),
    props: empty,
  }),
  z.strictObject({
    ...common,
    type: z.literal('LINE'),
    geometry: z.strictObject({ points: points(2, 2) }),
    props: empty,
  }),
  z.strictObject({
    ...common,
    type: z.literal('ARROW'),
    geometry: z.strictObject({ points: points(2, ELEMENT_LIMITS.arrowPoints) }),
    /** Phase 11: a head at the start too */
    props: z.strictObject({ doubleHeaded: z.boolean().optional() }).default({}),
  }),
  z.strictObject({
    ...common,
    type: z.literal('CIRCLE'),
    geometry: z.strictObject({
      center: PtSchema,
      r: z.number().int().min(ELEMENT_LIMITS.circleRadiusMin).max(ELEMENT_LIMITS.circleRadiusMax),
    }),
    props: empty,
  }),
  z.strictObject({
    ...common,
    type: z.literal('POLYGON'),
    geometry: z.strictObject({ points: points(3, ELEMENT_LIMITS.polygonPoints) }),
    props: empty,
  }),
  z.strictObject({
    ...common,
    type: z.literal('TEXT'),
    geometry: z.strictObject({ at: PtSchema }),
    props: z.strictObject({
      text: textField(1, ELEMENT_LIMITS.textMax),
      size: z.enum(['sm', 'md', 'lg']),
    }),
  }),
  z.strictObject({
    ...common,
    type: z.literal('MARKER'),
    geometry: z.strictObject({ at: PtSchema }),
    props: z
      .strictObject({
        kind: z.enum(MARKER_KINDS),
        number: z.number().int().min(1).max(ELEMENT_LIMITS.markerNumberMax).optional(),
        label: textField(0, ELEMENT_LIMITS.markerLabelMax).optional(),
        /** Phase 12: an own-player marker linked to a room member (label = their IGN, live) */
        memberId: z.uuid().optional(),
      })
      .refine((p) => p.memberId === undefined || p.kind === 'own_player', {
        message: 'Only own-player markers can be linked to a member',
        path: ['memberId'],
      }),
  }),
]);
export type ElementInput = z.output<typeof ElementInputSchema>;
export type ElementInputRaw = z.input<typeof ElementInputSchema>;

/** Stored / broadcast element (API_SPEC §1.5). */
export const ElementSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  layerId: z.uuid(),
  type: ElementTypeSchema,
  geometry: z.record(z.string(), z.unknown()),
  style: StyleSchema,
  props: z.record(z.string(), z.unknown()),
  z: z.number().int(),
  seq: z.number().int(),
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
});
export type Element = z.infer<typeof ElementSchema>;

/** Every coordinate of the element is inside the map (0…worldSize), circles included. */
export function elementWithinWorld(el: ElementInput, worldSize: number): boolean {
  const inside = ([x, y]: readonly [number, number]) => x <= worldSize && y <= worldSize;
  const g = el.geometry as {
    points?: [number, number][];
    center?: [number, number];
    r?: number;
    at?: [number, number];
  };
  if (g.points) return g.points.every(inside);
  if (g.center) return inside(g.center);
  if (g.at) return inside(g.at);
  return false;
}

/** Serialized size check (SECURITY V2: element JSON ≤ 64 KB). */
export function elementJsonBytes(el: unknown): number {
  return new TextEncoder().encode(JSON.stringify(el)).length;
}

// ---- layers --------------------------------------------------------------------------------

export const LayerInputSchema = z.strictObject({
  id: z.uuid(),
  name: textField(1, 32),
  color: HexColorSchema,
  visible: z.boolean(),
  locked: z.boolean(),
  /** omitted → appended at the end */
  position: z.number().int().min(0).max(9).optional(),
});
export type LayerInput = z.output<typeof LayerInputSchema>;
