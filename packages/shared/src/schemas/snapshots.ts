import { z } from 'zod';
import { HexColorSchema, textField } from '../text.js';
import { PublicUserSchema } from './auth.js';
import { ELEMENT_LIMITS, ElementTypeSchema, StyleSchema } from './elements.js';

/** Snapshots (FEATURES F10, DATABASE_SCHEMA §3.11, API_SPEC §5). */
export const SNAPSHOT_LIMITS = {
  nameMax: 60,
  /** at the limit the oldest must be deleted by hand */
  manualPerBoard: 50,
  /** the oldest auto snapshot is pruned past this */
  autoPerBoard: 10,
  /** serialized `data` cap (enforced in app; a DB CHECK is the backstop) */
  maxBytes: 5 * 1024 * 1024,
  /** `layer:clear` of more elements than this takes an auto snapshot first */
  clearAutoThreshold: 50,
} as const;

export const SNAPSHOT_VERSION = 1;

export const SnapshotLayerSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(32),
  color: HexColorSchema,
  position: z.number().int().min(0).max(9),
  visible: z.boolean(),
  locked: z.boolean(),
});
export const SnapshotElementSchema = z.object({
  id: z.uuid(),
  layerId: z.uuid(),
  type: ElementTypeSchema,
  geometry: z.record(z.string(), z.unknown()),
  style: StyleSchema,
  props: z.record(z.string(), z.unknown()),
  z: z.number().int(),
  createdBy: z.uuid().nullable(),
});

/** `{ version: 1, layers, elements }` — every element on one of the snapshot's layers. */
export const SnapshotDataSchema = z
  .object({
    version: z.literal(SNAPSHOT_VERSION),
    layers: z.array(SnapshotLayerSchema).min(1).max(10),
    elements: z.array(SnapshotElementSchema).max(ELEMENT_LIMITS.maxElementsPerBoard),
  })
  .refine(
    (d) => {
      const ids = new Set(d.layers.map((l) => l.id));
      return d.elements.every((e) => ids.has(e.layerId));
    },
    { message: 'Every element must be on one of the snapshot’s layers', path: ['elements'] },
  );
export type SnapshotData = z.infer<typeof SnapshotDataSchema>;
export type SnapshotLayer = z.infer<typeof SnapshotLayerSchema>;
export type SnapshotElement = z.infer<typeof SnapshotElementSchema>;

/** Board state → snapshot data (only the fields a restore needs; seqs are reassigned). */
export function buildSnapshotData(
  layers: readonly (SnapshotLayer & Record<string, unknown>)[],
  elements: readonly (SnapshotElement & Record<string, unknown>)[],
): SnapshotData {
  return {
    version: SNAPSHOT_VERSION,
    layers: [...layers]
      .sort((a, b) => a.position - b.position)
      .map((l, position) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        position,
        visible: l.visible,
        locked: l.locked,
      })),
    elements: elements.map((e) => ({
      id: e.id,
      layerId: e.layerId,
      type: e.type,
      geometry: e.geometry,
      style: e.style,
      props: e.props,
      z: e.z,
      createdBy: e.createdBy,
    })),
  };
}

/** UTF-8 size of the serialized data. */
export function snapshotBytes(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

/** Parses stored / received data; throws with the first issue when it isn't valid. */
export function parseSnapshotData(json: unknown): SnapshotData {
  const r = SnapshotDataSchema.safeParse(json);
  if (!r.success) throw new Error(`Invalid snapshot data: ${r.error.issues[0]?.message ?? '?'}`);
  return r.data;
}

export const SnapshotSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  isAuto: z.boolean(),
  elementCount: z.number().int(),
  createdBy: PublicUserSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SnapshotParamsSchema = z.strictObject({ snapshotId: z.uuid() });
export const CreateSnapshotBodySchema = z.strictObject({
  name: textField(1, SNAPSHOT_LIMITS.nameMax),
});
export type CreateSnapshotBody = z.input<typeof CreateSnapshotBodySchema>;
export const SnapshotsResponseSchema = z.object({ items: z.array(SnapshotSchema) });
export const SnapshotResponseSchema = z.object({ snapshot: SnapshotSchema });
export const SnapshotDetailResponseSchema = z.object({
  snapshot: SnapshotSchema,
  data: SnapshotDataSchema,
});
export type SnapshotDetailResponse = z.infer<typeof SnapshotDetailResponseSchema>;
export const RestoreSnapshotResponseSchema = z.object({ seq: z.number().int() });
