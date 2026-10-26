/**
 * Seed data (DATABASE_SCHEMA §7, ENVIRONMENT §5).
 *
 *   pnpm --filter server seed              dev: alice + bob, room "Demo Squad", and the demo boards
 *   pnpm --filter server seed --demo-only  only the three public demo boards (allowed in production)
 *
 * Idempotent: existing users and the existing demo room are reused, never duplicated. Prints
 * the `DEMO_BOARD_IDS=` line for the server's .env.
 */
import { MAP_IDS, MAPS, type MapId } from '@rotationlab/shared';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { newId } from '../src/lib/ids.js';
import { createPasswordHasher } from '../src/modules/auth/passwords.js';
import { defaultLayerRows } from '../src/modules/rooms/service.js';
import { demoElements } from './seedContent.js';

const demoOnly = process.argv.includes('--demo-only');
const production = process.env.NODE_ENV === 'production';
if (production && !demoOnly) {
  console.error('Refusing to seed dev users in production (use --demo-only for the demo boards).');
  process.exit(1);
}

const prisma = new PrismaClient();
const DEMO_USERNAME = 'rotationlab_demo';
const DEMO_ROOM = 'Explore demo boards';

const boardName = (mapId: MapId) => `${MAPS[mapId].name} – Plan 1`;

/** A board with the default layers and the sample content, counters consistent. */
async function createBoard(
  tx: Prisma.TransactionClient,
  roomId: string,
  mapId: MapId,
  position: number,
  authorId: string,
): Promise<string> {
  const boardId = newId();
  const layers = defaultLayerRows(boardId);
  const elements = demoElements(
    mapId,
    layers.map((l) => ({ id: l.id ?? '', name: l.name })),
    newId,
    boardId,
  );
  await tx.board.create({
    data: {
      id: boardId,
      roomId,
      name: boardName(mapId),
      mapId: mapId.toUpperCase() as 'ERANGEL' | 'MIRAMAR' | 'RONDO',
      position,
      lastSeq: BigInt(elements.length),
      elementCount: elements.length,
      createdBy: authorId,
    },
  });
  await tx.layer.createMany({ data: layers });
  await tx.element.createMany({
    data: elements.map((e, i) => ({
      id: e.id,
      boardId,
      layerId: e.layerId,
      type: e.type,
      geometry: e.geometry,
      style: e.style,
      props: e.props,
      z: i,
      seq: BigInt(i + 1),
      createdBy: authorId,
      updatedBy: authorId,
    })),
  });
  return boardId;
}

async function ensureUser(data: {
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
  avatarColor: string;
}) {
  const existing = await prisma.user.findUnique({ where: { username: data.username } });
  if (existing) return { user: existing, created: false };
  const user = await prisma.user.create({
    data: { id: newId(), ...data, emailVerifiedAt: new Date() },
  });
  return { user, created: true };
}

async function seedDemoBoards(): Promise<string[]> {
  const { user: demo } = await ensureUser({
    username: DEMO_USERNAME,
    email: 'demo@rotationlab.invalid',
    displayName: 'RotationLab',
    // not an argon2 hash: nobody can ever log in as the demo owner
    passwordHash: '!demo',
    avatarColor: '#F2A900',
  });
  const room = await prisma.room.findFirst({
    where: { ownerId: demo.id, name: DEMO_ROOM, deletedAt: null },
    include: { boards: { orderBy: { position: 'asc' } } },
  });
  if (room && room.boards.length > 0) return room.boards.map((b) => b.id);

  return prisma.$transaction(async (tx) => {
    const roomId = newId();
    await tx.room.create({
      data: {
        id: roomId,
        name: DEMO_ROOM,
        description: 'Read-only boards shown at /explore',
        ownerId: demo.id,
        defaultRole: 'VIEWER',
        isLocked: true,
      },
    });
    await tx.roomMember.create({ data: { roomId, userId: demo.id, role: 'OWNER' } });
    const ids: string[] = [];
    for (const [i, mapId] of MAP_IDS.entries())
      ids.push(await createBoard(tx, roomId, mapId, i, demo.id));
    return ids;
  });
}

async function seedDevData() {
  const password = process.env.SEED_DEV_PASSWORD;
  if (!password) throw new Error('SEED_DEV_PASSWORD is required for the dev seed');
  const hasher = createPasswordHasher({
    memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
    timeCost: Number(process.env.ARGON2_ITERATIONS ?? 2),
  });
  const hash = await hasher.hash(password);
  const { user: alice } = await ensureUser({
    username: 'alice',
    email: 'alice@example.com',
    displayName: 'Alice',
    passwordHash: hash,
    avatarColor: '#38BDF8',
  });
  const { user: bob } = await ensureUser({
    username: 'bob',
    email: 'bob@example.com',
    displayName: 'Bob',
    passwordHash: hash,
    avatarColor: '#22C55E',
  });
  const existing = await prisma.room.findFirst({
    where: { ownerId: alice.id, name: 'Demo Squad', deletedAt: null },
  });
  if (existing) return;
  await prisma.$transaction(async (tx) => {
    const roomId = newId();
    await tx.room.create({ data: { id: roomId, name: 'Demo Squad', ownerId: alice.id } });
    await tx.roomMember.createMany({
      data: [
        { roomId, userId: alice.id, role: 'OWNER' },
        { roomId, userId: bob.id, role: 'EDITOR' },
      ],
    });
    for (const [i, mapId] of MAP_IDS.entries()) await createBoard(tx, roomId, mapId, i, alice.id);
  });
  console.log('Seeded alice / bob (password: SEED_DEV_PASSWORD) and room "Demo Squad".');
}

try {
  if (!demoOnly) await seedDevData();
  const ids = await seedDemoBoards();
  console.log('Demo boards ready. Add this to apps/server/.env:');
  console.log(`DEMO_BOARD_IDS=${ids.join(',')}`);
} finally {
  await prisma.$disconnect();
}
