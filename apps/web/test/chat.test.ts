import type { ChatMessage } from '@rotationlab/shared';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { pingLabel } from '@/lib/chat';
import {
  addPending,
  emptyChat,
  failPending,
  groupMessages,
  loadPage,
  markDeleted,
  mergeMessages,
  receive,
  retryPending,
  shouldCountUnread,
  type ChatState,
} from '@/stores/chatModel';
import { reduceFollow, idleFollow, type FollowState } from '@/stores/followModel';
import { LASER_LIFETIME_MS, laserAlpha, pruneTrails } from '@/stores/laserStore';

const ROOM = '0192f7a1-0000-7000-8000-000000000001';
const BOARD = '0192f7a1-0000-7000-8000-00000000000b';
const ME = '0192f7a1-0000-7000-8000-0000000000aa';
const BOB = '0192f7a1-0000-7000-8000-0000000000bb';
const T0 = Date.parse('2026-10-26T10:00:00.000Z');

const user = (id: string, name: string) => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  ign: null,
  avatarColor: '#38BDF8',
});
let n = 0;
/** ids sort by creation like UUIDv7 */
const msg = (over: Partial<ChatMessage> & { at?: number } = {}): ChatMessage => {
  const { at = 0, ...rest } = over;
  n += 1;
  return {
    id: `0192f7a1-0000-7000-8000-${String(n).padStart(12, '0')}`,
    roomId: ROOM,
    author: user(BOB, 'Bob'),
    kind: 'USER',
    body: `m${n}`,
    ping: null,
    deleted: false,
    clientId: null,
    createdAt: new Date(T0 + at).toISOString(),
    ...rest,
  };
};

let s: ChatState;
const act = (fn: (d: ChatState) => void) => {
  s = produce(s, fn);
};

describe('message grouping (FEATURES F9)', () => {
  it('groups consecutive messages of one author within 2 min', () => {
    const list = [
      msg({ at: 0 }),
      msg({ at: 60_000 }),
      msg({ at: 179_000 }), // 119 s after the previous one → same group
      msg({ at: 400_000 }), // > 2 min gap → new group
      msg({ at: 401_000, author: user(ME, 'Me') }),
    ];
    const groups = groupMessages(list, [], user(ME, 'Me'));
    expect(groups.map((g) => (g.kind === 'author' ? g.items.length : 'sys'))).toEqual([3, 1, 1]);
  });

  it('system messages stand alone and break a group', () => {
    const list = [
      msg({ at: 0 }),
      msg({ at: 1_000, kind: 'SYSTEM', author: null, body: 'Ana joined the room' }),
      msg({ at: 2_000 }),
    ];
    expect(groupMessages(list, [], null).map((g) => g.kind)).toEqual([
      'author',
      'system',
      'author',
    ]);
  });

  it('my pending messages join my last group when close enough', () => {
    const mine = msg({ at: 0, author: user(ME, 'Me') });
    const pending = [
      {
        clientId: 'c1',
        body: 'sending',
        ping: null,
        createdAt: new Date(T0 + 5_000).toISOString(),
        status: 'sending' as const,
      },
    ];
    const groups = groupMessages([mine], pending, user(ME, 'Me'));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind === 'author' && groups[0].items.map((i) => i.kind)).toEqual([
      'message',
      'pending',
    ]);
  });
});

describe('chat state', () => {
  it('merges pages and live messages in id order, without duplicates', () => {
    s = emptyChat(ROOM, ME);
    const [a, b, c] = [msg(), msg(), msg()];
    act((d) => {
      loadPage(d, { items: [c, b], nextCursor: b.id }, false);
      mergeMessages(d, [a, c]);
    });
    expect(s.order).toEqual([a.id, b.id, c.id]);
    expect(s.nextCursor).toBe(b.id);
    // a refresh of the latest page (reconnect) keeps the older-history cursor
    act((d) => {
      loadPage(d, { items: [c], nextCursor: null }, false);
    });
    expect(s.nextCursor).toBe(b.id);
    act((d) => {
      loadPage(d, { items: [a], nextCursor: null }, true);
    });
    expect(s.nextCursor).toBeNull();
  });

  it('ignores messages for another room', () => {
    s = emptyChat(ROOM, ME);
    act((d) => {
      mergeMessages(d, [msg({ roomId: '0192f7a1-0000-7000-8000-0000000000ff' })]);
    });
    expect(s.order).toEqual([]);
  });

  it('optimistic send: pending until the stored copy (ack or broadcast) arrives; retry after a failure', () => {
    s = emptyChat(ROOM, ME);
    act((d) => {
      addPending(d, {
        clientId: 'k1',
        body: 'go school',
        ping: null,
        createdAt: new Date(T0).toISOString(),
      });
    });
    expect(s.pending.map((p) => p.status)).toEqual(['sending']);
    act((d) => {
      failPending(d, 'k1', 'Not sent');
    });
    expect(s.pending[0]).toMatchObject({ status: 'failed', error: 'Not sent' });
    act((d) => {
      retryPending(d, 'k1');
    });
    expect(s.pending[0]?.status).toBe('sending');
    act((d) => {
      receive(d, msg({ clientId: 'k1', author: user(ME, 'Me') }), false);
    });
    expect(s.pending).toEqual([]);
    expect(s.order).toHaveLength(1);
  });

  it('deleted messages show the placeholder and lose their ping', () => {
    s = emptyChat(ROOM, ME);
    const m = msg({ ping: { boardId: BOARD, x: 1, y: 2 } });
    act((d) => {
      mergeMessages(d, [m]);
      markDeleted(d, m.id);
    });
    expect(s.byId[m.id]).toMatchObject({ deleted: true, body: 'message deleted', ping: null });
  });
});

describe('unread counting', () => {
  it('counts others’ messages while the chat is hidden; never mine, system or duplicates', () => {
    s = emptyChat(ROOM, ME);
    const bob = msg();
    act((d) => {
      receive(d, bob, false);
      receive(d, bob, false); // duplicate broadcast
      receive(d, msg({ author: user(ME, 'Me') }), false);
      receive(d, msg({ kind: 'SYSTEM', author: null }), false);
      receive(d, msg(), true); // chat visible
    });
    expect(s.unread).toBe(1);
    expect(shouldCountUnread(msg({ deleted: true }), ME, false)).toBe(false);
  });
});

describe('ping chip label', () => {
  const boards = [{ id: BOARD, name: 'Erangel – Drop A', mapId: 'erangel' as const }];
  it('grid ref on that board’s map + board name', () => {
    expect(pingLabel({ boardId: BOARD, x: 408_000, y: 408_000 }, boards)).toEqual({
      text: '📍 E-M 0,0 · Erangel – Drop A',
      disabled: false,
    });
  });
  it('a deleted board (null, or no longer listed) → disabled chip', () => {
    expect(pingLabel({ boardId: null, x: 1, y: 1 }, boards).disabled).toBe(true);
    expect(
      pingLabel({ boardId: '0192f7a1-0000-7000-8000-0000000000ee', x: 1, y: 1 }, boards).disabled,
    ).toBe(true);
  });
});

describe('follow reducer (FEATURES F8)', () => {
  const ctx = { meId: ME, nameOf: (id: string) => (id === BOB ? 'Bob' : 'someone') };
  let f: FollowState = idleFollow;
  const run = (a: Parameters<typeof reduceFollow>[1]) => {
    const r = reduceFollow(f, a, ctx);
    f = r.state;
    return r.effects;
  };

  it('start emits follow:start; never myself; starting someone else stops the first', () => {
    f = idleFollow;
    expect(run({ type: 'start', leaderId: ME })).toEqual([]);
    expect(run({ type: 'start', leaderId: BOB })).toEqual([{ kind: 'emitStart', leaderId: BOB }]);
    expect(run({ type: 'start', leaderId: BOB })).toEqual([]); // already
    expect(run({ type: 'start', leaderId: 'ana' })).toEqual([
      { kind: 'emitStop', leaderId: BOB },
      { kind: 'emitStart', leaderId: 'ana' },
    ]);
    expect(f.leaderId).toBe('ana');
  });

  it('a manual pan / zoom stops following with "Stopped following"', () => {
    f = { leaderId: BOB, summoned: false };
    expect(run({ type: 'manualMove' })).toEqual([
      { kind: 'emitStop', leaderId: BOB },
      { kind: 'toast', message: 'Stopped following' },
    ]);
    expect(f).toEqual(idleFollow);
    expect(run({ type: 'manualMove' })).toEqual([]); // not following: nothing
  });

  it('the leader leaving or disconnecting stops it with a toast; others coming and going don’t', () => {
    f = { leaderId: BOB, summoned: true };
    expect(run({ type: 'presence', online: new Set([ME, BOB, 'ana']) })).toEqual([]);
    expect(run({ type: 'presence', online: new Set([ME]) })).toEqual([
      { kind: 'emitStop', leaderId: BOB },
      { kind: 'toast', message: 'Bob left — stopped following' },
    ]);
    expect(f.leaderId).toBeNull();
  });

  it('Stop / Don’t follow is silent', () => {
    f = { leaderId: BOB, summoned: true };
    expect(run({ type: 'stop' })).toEqual([{ kind: 'emitStop', leaderId: BOB }]);
  });
});

describe('laser trails', () => {
  it('points expire after 1.5 s; users with nothing left disappear', () => {
    const now = 10_000;
    const trails = {
      a: [
        { x: 1, y: 1, t: now - LASER_LIFETIME_MS - 1 },
        { x: 2, y: 2, t: now - 100 },
      ],
      b: [{ x: 3, y: 3, t: now - 2_000 }],
    };
    expect(pruneTrails(trails, now)).toEqual({ a: [{ x: 2, y: 2, t: now - 100 }] });
  });

  it('fades linearly from 1 to 0 over the lifetime', () => {
    expect(laserAlpha({ x: 0, y: 0, t: 1_000 }, 1_000)).toBe(1);
    expect(laserAlpha({ x: 0, y: 0, t: 1_000 }, 1_750)).toBeCloseTo(0.5);
    expect(laserAlpha({ x: 0, y: 0, t: 1_000 }, 3_000)).toBe(0);
  });
});
