/**
 * Load-test fixtures (TESTING §7, Phase 10): ROOMS rooms × USERS editors, one Erangel board each,
 * plus a freshly minted access token per user — the production rate limits (rightly) make
 * registering hundreds of users through the API impossible. Prints JSON for loadtest/realtime.js.
 * Run inside the server container, where JWT_SECRET and DATABASE_URL are set:
 *
 *   docker compose run --rm --no-deps server ./node_modules/.bin/tsx scripts/loadtest-seed.ts \
 *     --rooms 100 --users 5 > loadtest/users.json
 *   … scripts/loadtest-seed.ts --cleanup      # deletes every load-test user and room
 *
 * Load-test accounts use the reserved `loadtest.invalid` email domain and a password hash nobody
 * can log in with. Never point this at production data you care about.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AUTH_COOKIES } from '@rotationlab/shared';
import { loadConfig } from '../src/config.js';
import { newId } from '../src/lib/ids.js';
import { createTokenService } from '../src/modules/auth/tokens.js';
import { defaultLayerRows } from '../src/modules/rooms/service.js';

const DOMAIN = '@loadtest.invalid';
const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const config = loadConfig();
const prisma = new PrismaClient();

async function cleanup() {
  const owners = { owner: { email: { endsWith: DOMAIN } } };
  const rooms = await prisma.room.deleteMany({ where: owners });
  const users = await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  console.error(`cleanup: deleted ${rooms.count} rooms, ${users.count} users`);
}

async function seed(roomCount: number, usersPerRoom: number) {
  const tokens = createTokenService({
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    ttlSec: config.ACCESS_TOKEN_TTL_SEC,
  });
  const run = Date.now().toString(36);
  const out: { token: string; userId: string; roomId: string; boardId: string; layerId: string }[] =
    [];

  for (let r = 0; r < roomCount; r++) {
    const users = Array.from({ length: usersPerRoom }, (_, u) => ({
      id: newId(),
      username: `lt${run}_${r}_${u}`.slice(0, 20),
      email: `lt${run}_${r}_${u}${DOMAIN}`,
      displayName: `Load ${r}.${u}`,
      passwordHash: '!loadtest', // not an argon2 hash: no one can log in
    }));
    const owner = users[0];
    const roomId = newId();
    const boardId = newId();
    const layers = defaultLayerRows(boardId);
    const layerId = layers[0]?.id;
    if (!owner || !layerId) throw new Error('need ≥ 1 user per room and a default layer');
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({ data: users });
      await tx.room.create({
        data: { id: roomId, name: `Load test ${run} #${r}`, ownerId: owner.id },
      });
      await tx.roomMember.createMany({
        data: users.map((u, i) => ({ roomId, userId: u.id, role: i === 0 ? 'OWNER' : 'EDITOR' })),
      });
      await tx.board.create({
        data: {
          id: boardId,
          roomId,
          name: 'Erangel – Load',
          mapId: 'ERANGEL',
          position: 0,
          createdBy: owner.id,
        },
      });
      await tx.layer.createMany({ data: layers });
    });
    for (const u of users) {
      out.push({
        token: await tokens.sign({ sub: u.id, sid: randomUUID() }),
        userId: u.id,
        roomId,
        boardId,
        layerId,
      });
    }
  }
  const cookieName = config.COOKIE_SECURE ? AUTH_COOKIES.accessSecure : AUTH_COOKIES.access;
  console.log(JSON.stringify({ origin: config.APP_ORIGIN, cookieName, users: out }));
  console.error(
    `seeded ${roomCount} rooms × ${usersPerRoom} users; tokens valid ${config.ACCESS_TOKEN_TTL_SEC} s`,
  );
}

try {
  if (args.includes('--cleanup')) await cleanup();
  else await seed(arg('rooms', 100), arg('users', 5));
} finally {
  await prisma.$disconnect();
}
