import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import {
  ack,
  connect,
  joinBoard,
  listen,
  makeApp,
  nextEvent,
  setupRoom,
  useCleanState,
} from './harness.js';

/** Follow & summon plumbing (FEATURES F8): leaders learn their follower count. */

useCleanState();

let app: App;
let url: string;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
  url = await listen(app);
});

describe('followers:update', () => {
  it('counts follow:start / follow:stop and a follower that disconnects', async () => {
    const f = await setupRoom(app);
    const leader = await connect(url, f.owner.jar);
    const first = nextEvent<{ count: number }>(leader, 'followers:update');
    await joinBoard(leader, f.roomId, f.boardId);
    expect(await first).toEqual({ count: 0 }); // told on join (a reconnecting leader resyncs)

    const a = await connect(url, f.editor.jar);
    const b = await connect(url, f.viewer.jar);
    await joinBoard(a, f.roomId, f.boardId);
    await joinBoard(b, f.roomId, f.boardId);

    let next = nextEvent<{ count: number }>(leader, 'followers:update');
    await ack(a, 'follow:start', { targetUserId: f.owner.id });
    expect(await next).toEqual({ count: 1 });
    next = nextEvent(leader, 'followers:update');
    await ack(b, 'follow:start', { targetUserId: f.owner.id });
    expect(await next).toEqual({ count: 2 });
    next = nextEvent(leader, 'followers:update');
    await ack(a, 'follow:stop', { targetUserId: f.owner.id });
    expect(await next).toEqual({ count: 1 });
    next = nextEvent(leader, 'followers:update');
    b.disconnect();
    expect(await next).toEqual({ count: 0 });
  });

  it('view:update reaches followers only; summon reaches the room', async () => {
    const f = await setupRoom(app);
    const leader = await connect(url, f.owner.jar);
    const follower = await connect(url, f.editor.jar);
    const bystander = await connect(url, f.viewer.jar);
    for (const s of [leader, follower, bystander]) await joinBoard(s, f.roomId, f.boardId);
    await ack(follower, 'follow:start', { targetUserId: f.owner.id });
    const got = nextEvent(follower, 'view:update');
    const summon = nextEvent(bystander, 'summon');
    leader.emit('view:update', { boardId: f.boardId, center: [400_000, 400_000], zoom: 2 });
    expect(await got).toMatchObject({ userId: f.owner.id, boardId: f.boardId, zoom: 2 });
    expect(await ack(leader, 'summon', { boardId: f.boardId })).toMatchObject({ ok: true });
    expect(await summon).toEqual({ userId: f.owner.id, boardId: f.boardId });
  });
});
