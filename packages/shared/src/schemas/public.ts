import { z } from 'zod';
import { ElementSchema } from './elements.js';
import { BoardSchema, LayerSchema } from './rooms.js';

/**
 * `GET /api/v1/public/demo-boards` (FEATURES F13, API_SPEC §8): the read-only boards behind
 * `/explore`. Only boards listed in `DEMO_BOARD_IDS` are ever served, and nothing that points
 * back at a room or a user: no room id, no author ids.
 */
export const DemoBoardSchema = z.object({
  board: BoardSchema.omit({ roomId: true }),
  layers: z.array(LayerSchema),
  elements: z.array(ElementSchema.extend({ createdBy: z.null(), updatedBy: z.null() })),
});
export type DemoBoard = z.infer<typeof DemoBoardSchema>;

export const DemoBoardsResponseSchema = z.object({ items: z.array(DemoBoardSchema) });
export type DemoBoardsResponse = z.infer<typeof DemoBoardsResponseSchema>;

/** At most one demo board per map, in env order. */
export const DEMO_BOARDS_MAX = 3;
