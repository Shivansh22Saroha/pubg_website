import type { DemoBoard } from '@rotationlab/shared';
import type { PrismaClient } from '@prisma/client';
import { toElement } from '../elements/service.js';
import { toBoard, toLayer } from '../rooms/mappers.js';

/**
 * Demo boards for `/explore` (FEATURES F13). The allow-list is the only gate: a board is served
 * only when its id is in `DEMO_BOARD_IDS` (and its room isn't deleted); anything else — a real
 * board id passed some other way — can't be reached, because the id list never comes from the
 * request. Room ids and author ids are stripped.
 */
export function createPublicService({
  prisma,
  demoBoardIds,
}: {
  prisma: PrismaClient;
  demoBoardIds: readonly string[];
}) {
  return {
    async demoBoards(): Promise<DemoBoard[]> {
      if (demoBoardIds.length === 0) return [];
      const rows = await prisma.board.findMany({
        where: { id: { in: [...demoBoardIds] }, room: { deletedAt: null } },
        include: {
          layers: { orderBy: { position: 'asc' } },
          elements: { orderBy: [{ z: 'asc' }, { seq: 'asc' }] },
        },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      // env order (one per map), skipping ids that don't exist (any more)
      return demoBoardIds.flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        const { roomId: _roomId, ...board } = toBoard(row);
        return [
          {
            board,
            layers: row.layers.map(toLayer),
            elements: row.elements.map((e) => ({
              ...toElement(e),
              createdBy: null,
              updatedBy: null,
            })),
          },
        ];
      });
    },
  };
}
export type PublicService = ReturnType<typeof createPublicService>;
