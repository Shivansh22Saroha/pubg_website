import { VOICE_MAX_PEERS } from '@rotationlab/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { STUN_ONLY } from '../../src/modules/voice/turn.js';
import {
  accept,
  ack,
  call,
  collect,
  connect,
  invite,
  listen,
  makeApp,
  newUser,
  nextEvent,
  setupRoom,
  sleep,
  useCleanState,
  type ClientSocket,
  type RoomFixture,
} from './harness.js';

/** Voice chat signalling (FEATURES F19, SECURITY VC1–VC3). */
useCleanState();

let app: App;
let url: string;
beforeAll(async () => {
  ({ app } = await makeApp({ RATE_LIMITS_ENABLED: 'false' }));
  url = await listen(app);
});

async function joined(jar: RoomFixture['owner']['jar'], roomId: string) {
  const s = await connect(url, jar);
  const r = await ack(s, 'room:join', { roomId });
  if (!r.ok) throw new Error(`room:join ${r.code}`);
  return s;
}

async function voiceJoin(s: ClientSocket, roomId: string) {
  return ack(s, 'voice:join', { roomId });
}

/** waits until `socket` has been told the channel holds exactly `n` peers */
async function peersUntil(socket: ClientSocket, roomId: string, n: number) {
  for (;;) {
    const p = await nextEvent<{ roomId: string; peers: { peerId: string; userId: string }[] }>(
      socket,
      'voice:peers',
    );
    if (p.roomId === roomId && p.peers.length === n) return p.peers;
  }
}

describe('voice', () => {
  it('join returns the other peers and ICE servers; the whole room sees the channel', async () => {
    const f = await setupRoom(app);
    const owner = await joined(f.owner.jar, f.roomId);
    const viewer = await joined(f.viewer.jar, f.roomId); // stays out of voice
    const viewerSees = peersUntil(viewer, f.roomId, 1);
    const a = await voiceJoin(owner, f.roomId);
    expect(a).toMatchObject({ ok: true, data: { peers: [], iceServers: STUN_ONLY } });
    expect(a.data.peerId).toBe(owner.id);
    expect(await viewerSees).toEqual([{ peerId: owner.id, userId: f.owner.id, muted: true }]);

    const editor = await joined(f.editor.jar, f.roomId);
    const b = await voiceJoin(editor, f.roomId);
    expect(b.data.peers).toEqual([{ peerId: owner.id, userId: f.owner.id, muted: true }]);
  });

  it('room:join tells a newcomer who is already in voice', async () => {
    const f = await setupRoom(app);
    const owner = await joined(f.owner.jar, f.roomId);
    await voiceJoin(owner, f.roomId);
    const late = await connect(url, f.viewer.jar);
    const first = nextEvent<{ peers: unknown[] }>(late, 'voice:peers');
    await ack(late, 'room:join', { roomId: f.roomId });
    expect((await first).peers).toHaveLength(1);
  });

  it('mute is broadcast; muting outside voice is refused', async () => {
    const f = await setupRoom(app);
    const owner = await joined(f.owner.jar, f.roomId);
    const editor = await joined(f.editor.jar, f.roomId);
    expect(await ack(owner, 'voice:mute', { roomId: f.roomId, muted: false })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    await voiceJoin(owner, f.roomId);
    await sleep(100);
    const seen = collect<{ peers: { muted: boolean }[] }>(editor, 'voice:peers');
    expect(await ack(owner, 'voice:mute', { roomId: f.roomId, muted: false })).toMatchObject({
      ok: true,
    });
    await sleep(200);
    expect(seen.at(-1)?.peers[0]?.muted).toBe(false);
  });

  it(`holds at most ${VOICE_MAX_PEERS} people, even when they all join at once`, async () => {
    const f = await setupRoom(app);
    const code = (await invite(app, f.owner.jar, f.roomId, { role: 'VIEWER', maxUses: 20 })).code;
    const jars = [f.owner.jar, f.editor.jar, f.viewer.jar];
    for (let i = 0; i < VOICE_MAX_PEERS - 2; i += 1) {
      const u = await newUser(app, `voice${i}`);
      expect((await accept(app, u.jar, code)).statusCode).toBe(200);
      jars.push(u.jar);
    }
    const sockets = await Promise.all(jars.map((j) => joined(j, f.roomId)));
    const results = await Promise.all(sockets.map((s) => voiceJoin(s, f.roomId)));
    expect(results.filter((r) => r.ok)).toHaveLength(VOICE_MAX_PEERS);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ code: 'LIMIT_REACHED' }),
    ]);
  });

  it('one voice tab per user: joining from a second tab ends the first', async () => {
    const f = await setupRoom(app);
    const tab1 = await joined(f.owner.jar, f.roomId);
    const tab2 = await joined(f.owner.jar, f.roomId);
    await voiceJoin(tab1, f.roomId);
    const ended = nextEvent(tab1, 'voice:ended');
    const r = await voiceJoin(tab2, f.roomId);
    expect(await ended).toEqual({ roomId: f.roomId, reason: 'elsewhere' });
    expect(r.data.peers).toEqual([]);
    // the old tab is out: it can't mute or signal any more
    expect(await ack(tab1, 'voice:mute', { roomId: f.roomId, muted: false })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    const seen = collect(tab2, 'voice:signal');
    tab1.emit('voice:signal', {
      roomId: f.roomId,
      to: tab2.id!,
      data: { type: 'offer', sdp: 'v=0' },
    });
    await sleep(300);
    expect(seen).toHaveLength(0);
  });

  it('signals go to the addressed peer only, with the real sender id', async () => {
    const f = await setupRoom(app);
    const [a, b, c] = await Promise.all([
      joined(f.owner.jar, f.roomId),
      joined(f.editor.jar, f.roomId),
      joined(f.viewer.jar, f.roomId),
    ]);
    for (const s of [a, b, c]) await voiceJoin(s, f.roomId);
    const atB = collect<{ from: string; data: unknown }>(b, 'voice:signal');
    const atC = collect(c, 'voice:signal');
    const data = { type: 'ice', candidate: { candidate: '', sdpMid: '0', sdpMLineIndex: 0 } };
    a.emit('voice:signal', { roomId: f.roomId, to: b.id!, data } as never);
    await sleep(300);
    expect(atB).toEqual([{ roomId: f.roomId, from: a.id, data }]);
    expect(atC).toHaveLength(0);
  });

  it('signals to a socket outside the channel are dropped', async () => {
    const f = await setupRoom(app);
    const a = await joined(f.owner.jar, f.roomId);
    const b = await joined(f.editor.jar, f.roomId); // in the room, not in voice
    await voiceJoin(a, f.roomId);
    const atB = collect(b, 'voice:signal');
    a.emit('voice:signal', { roomId: f.roomId, to: b.id!, data: { type: 'offer', sdp: 'v=0' } });
    await sleep(300);
    expect(atB).toHaveLength(0);
  });

  it('disconnect, room:leave and a kick all take people out of voice', async () => {
    const f = await setupRoom(app);
    const owner = await joined(f.owner.jar, f.roomId);
    const editor = await joined(f.editor.jar, f.roomId);
    const viewer = await joined(f.viewer.jar, f.roomId);
    for (const s of [owner, editor, viewer]) await voiceJoin(s, f.roomId);
    await sleep(100);

    let next = peersUntil(owner, f.roomId, 2);
    editor.disconnect();
    expect((await next).map((p) => p.userId)).not.toContain(f.editor.id);

    const editor2 = await joined(f.editor.jar, f.roomId);
    await voiceJoin(editor2, f.roomId);
    await sleep(100);
    next = peersUntil(owner, f.roomId, 2);
    await ack(editor2, 'room:leave', { roomId: f.roomId });
    expect((await next).map((p) => p.userId)).not.toContain(f.editor.id);

    next = peersUntil(owner, f.roomId, 1);
    const kick = await call(
      app,
      f.owner.jar,
      'DELETE',
      `/api/v1/rooms/${f.roomId}/members/${f.viewer.id}`,
    );
    expect(kick.statusCode).toBe(204);
    expect((await next).map((p) => p.userId)).toEqual([f.owner.id]);
  });

  it('an outsider can neither join nor see the channel', async () => {
    const f = await setupRoom(app);
    const owner = await joined(f.owner.jar, f.roomId);
    await voiceJoin(owner, f.roomId);
    const outsider = await connect(url, f.outsider.jar);
    const seen = collect(outsider, 'voice:peers');
    expect(await ack(outsider, 'room:join', { roomId: f.roomId })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await voiceJoin(outsider, f.roomId)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await ack(owner, 'voice:mute', { roomId: f.roomId, muted: false });
    await sleep(200);
    expect(seen).toHaveLength(0);
  });
});
