import type { Prisma, Snapshot as SnapshotRow, User } from '@prisma/client';
import {
  buildSnapshotData,
  SNAPSHOT_LIMITS,
  snapshotBytes,
  type Snapshot,
  type StyleSchema,
} from '@rotationlab/shared';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { toPublicUser } from '../rooms/mappers.js';

type Tx = Prisma.TransactionClient;

export function toSnapshot(row: SnapshotRow & { author: User | null }): Snapshot {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    isAuto: row.isAuto,
    elementCount: row.elementCount,
    createdBy: row.author ? toPublicUser(row.author) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** "Before restore of 'Plan A'" within the 60-character name limit. */
export function autoName(prefix: string, name: string): string {
  const max = SNAPSHOT_LIMITS.nameMax - prefix.length - 2; // the quotes
  const chars = Array.from(name);
  const shown = chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : name;
  return `${prefix}'${shown}'`;
}

/**
 * Snapshot of the board's current layers + elements, inside the caller's transaction (which
 * should hold the board row lock, so the copy is consistent). Auto snapshots keep only the
 * newest 10 per board; `keep` protects one snapshot from that pruning (the one being restored).
 */
export async function captureSnapshot(
  tx: Tx,
  opts: { boardId: string; name: string; isAuto: boolean; createdBy: string | null; keep?: string },
): Promise<SnapshotRow> {
  const layers = await tx.layer.findMany({
    where: { boardId: opts.boardId },
    orderBy: { position: 'asc' },
  });
  const elements = await tx.element.findMany({
    where: { boardId: opts.boardId },
    orderBy: [{ z: 'asc' }, { seq: 'asc' }],
  });
  const data = buildSnapshotData(
    layers,
    elements.map((e) => ({
      ...e,
      geometry: e.geometry as Record<string, unknown>,
      style: e.style as z.infer<typeof StyleSchema>,
      props: e.props as Record<string, unknown>,
    })),
  );
  if (snapshotBytes(data) > SNAPSHOT_LIMITS.maxBytes)
    throw new AppError('PAYLOAD_TOO_LARGE', 'This board is too large to snapshot (max 5 MB)');
  const row = await tx.snapshot.create({
    data: {
      id: newId(),
      boardId: opts.boardId,
      name: opts.name,
      isAuto: opts.isAuto,
      data: data as unknown as Prisma.InputJsonValue,
      elementCount: elements.length,
      createdBy: opts.createdBy,
    },
  });
  if (opts.isAuto) {
    // the protected one still counts toward the 10: prune the oldest of the others
    const kept = opts.keep
      ? await tx.snapshot.count({ where: { id: opts.keep, boardId: opts.boardId, isAuto: true } })
      : 0;
    const stale = await tx.snapshot.findMany({
      where: {
        boardId: opts.boardId,
        isAuto: true,
        ...(opts.keep ? { id: { not: opts.keep } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: SNAPSHOT_LIMITS.autoPerBoard - kept,
      select: { id: true },
    });
    if (stale.length > 0)
      await tx.snapshot.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
  return row;
}
