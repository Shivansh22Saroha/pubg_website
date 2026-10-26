'use client';

import type {
  AckResult,
  Board,
  BoardSubscribeAck,
  Pt,
  ErrorCode,
  RoomDetailResponse,
  RoomJoinAck,
  RoomRole,
  ServerToClientEvents,
  Style,
} from '@rotationlab/shared';
import type { QueryClient } from '@tanstack/react-query';
import { v7 as uuid } from 'uuid';
import { keys } from '@/lib/rooms';
import { hasGap, type LocalOp, type PendingOp } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { planSends, toWire } from './batching';
import { getSocket, startRealtime } from './socket';
import type { RtSocket } from './connection';

export const HEARTBEAT_MS = 20_000;
export const IDLE_AFTER_MS = 120_000;
export const CURSOR_INTERVAL_MS = 50; // 20 Hz (RT-2)
const ACK_TIMEOUT_MS = 10_000;
const GAP_RESYNC_MS = 2_000;
/** transient server answers: keep the op and try again */
const RETRY_CODES = new Set<ErrorCode>(['CONFLICT', 'RATE_LIMITED', 'INTERNAL']);

export interface RoomSessionCallbacks {
  /** this user was kicked / lost access (room:join → NOT_FOUND too) */
  onKicked: () => void;
  onRoomDeleted: () => void;
  /** the board this user is on was deleted */
  onActiveBoardDeleted: (fallback: Board | undefined) => void;
  onRoleChanged: (role: RoomRole) => void;
  onReject: (message: string) => void;
}

type AnyAck = AckResult<unknown>;

/**
 * One room's realtime session (ARCHITECTURE §7): join on every (re)connect, resubscribe the
 * board with `sinceSeq` (delta) and resend still-pending ops in their original order with the
 * same opIds — the server dedupes, so a resend is always safe.
 */
export class RoomSession {
  private socket: RtSocket = getSocket();
  private boardId: string | null = null;
  private joined = false;
  private generation = 0;
  private inFlight = new Map<string, number>(); // opId → connection generation
  private timers: ReturnType<typeof setInterval>[] = [];
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInput = Date.now();
  private idle = false;
  private lastCursor = 0;
  private pendingCursor: { x: number; y: number } | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private offs: (() => void)[] = [];

  constructor(
    readonly roomId: string,
    private readonly meId: string,
    private readonly queryClient: QueryClient,
    private readonly cb: RoomSessionCallbacks,
  ) {}

  // ---- lifecycle -------------------------------------------------------------------------

  start() {
    useBoardStore.getState().setMe(this.meId);
    this.listen();
    this.timers.push(
      setInterval(() => {
        this.heartbeat();
      }, HEARTBEAT_MS),
    );
    this.timers.push(
      setInterval(() => {
        this.checkIdle();
      }, 5_000),
    );
    const onInput = () => {
      this.lastInput = Date.now();
      if (this.idle) this.checkIdle();
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(ev, onInput, { passive: true });
      this.offs.push(() => {
        window.removeEventListener(ev, onInput);
      });
    }
    if (this.socket.connected) void this.onConnect();
    startRealtime();
  }

  stop() {
    for (const off of this.offs.splice(0)) off();
    for (const t of this.timers.splice(0)) clearInterval(t);
    if (this.gapTimer) clearTimeout(this.gapTimer);
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    if (this.socket.connected && this.joined)
      this.socket.emit('room:leave', { roomId: this.roomId }, () => undefined);
    this.joined = false;
    usePresenceStore.getState().clear();
  }

  setBoard(boardId: string) {
    if (this.boardId === boardId) return;
    this.boardId = boardId;
    useBoardStore.getState().switchBoard(boardId);
    const presence = usePresenceStore.getState();
    for (const id of Object.keys(presence.cursors)) presence.dropCursor(id);
    for (const id of Object.keys(presence.ghosts)) presence.dropGhost(id);
    if (this.joined && this.socket.connected) void this.subscribe(false);
  }

  // ---- connect / resync ------------------------------------------------------------------

  private onConnect = async () => {
    this.generation += 1;
    this.inFlight.clear();
    this.joined = false;
    if (!(await this.join())) return;
    if (this.boardId) await this.subscribe(true);
    this.flush();
  };

  private async join(): Promise<boolean> {
    const res = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('room:join', { roomId: this.roomId })
      .catch(() => null)) as AnyAck | null;
    if (!res) return false;
    if (!res.ok) {
      if (res.code === 'NOT_FOUND') this.cb.onKicked();
      return false;
    }
    const data = res.data as RoomJoinAck;
    this.joined = true;
    usePresenceStore.getState().setUsers(this.roomId, data.presence);
    this.queryClient.setQueryData<RoomDetailResponse>(keys.room(this.roomId), (prev) =>
      prev
        ? {
            ...prev,
            room: { ...data.room, role: prev.room.role },
            members: data.members,
            boards: data.boards,
          }
        : prev,
    );
    return true;
  }

  private async subscribe(resume: boolean) {
    const boardId = this.boardId;
    if (!boardId) return;
    const store = useBoardStore.getState();
    const sinceSeq = resume && store.boardId === boardId && store.ready ? store.lastSeq : undefined;
    const res = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('board:subscribe', { boardId, ...(sinceSeq !== undefined ? { sinceSeq } : {}) })
      .catch(() => null)) as AnyAck | null;
    if (!res?.ok || this.boardId !== boardId) return;
    useBoardStore.getState().subscribed(boardId, res.data as BoardSubscribeAck);
  }

  /**
   * Resends every pending op not already in flight on this connection, in order. Consecutive
   * element ops travel as `element:batch` (≤ 50 ops / ≤ 60 KB) so a long offline queue doesn't
   * trip the durable-op rate limit.
   */
  private flush() {
    this.emitAll(
      useBoardStore.getState().pending.filter((p) => this.inFlight.get(p.opId) !== this.generation),
    );
  }

  private emitAll(list: PendingOp[]) {
    for (const chunk of planSends(list)) {
      const [first] = chunk;
      if (chunk.length === 1 && first) this.emitOp(first);
      else if (chunk.length > 1) this.emitBatch(chunk);
    }
  }

  private emitBatch(chunk: PendingOp[]) {
    const boardId = chunk[0]?.boardId;
    if (!boardId) return;
    const gen = this.generation;
    for (const p of chunk) this.inFlight.set(p.opId, gen);
    const ops = chunk.map((p) =>
      p.op.kind === 'element:upsert'
        ? { opId: p.opId, kind: 'upsert', element: p.op.element }
        : { opId: p.opId, kind: 'delete', elementId: (p.op as { elementId: string }).elementId },
    );
    (
      this.socket.timeout(ACK_TIMEOUT_MS) as unknown as {
        emitWithAck: (e: string, p: unknown) => Promise<AnyAck>;
      }
    )
      .emitWithAck('element:batch', { boardId, ops })
      .then((res) => {
        for (const p of chunk) this.inFlight.delete(p.opId);
        if (res.ok) {
          const seqs = (res.data as { seqs: number[] }).seqs;
          chunk.forEach((p, i) => {
            useBoardStore.getState().ack(p.opId, seqs[i] ?? 0);
          });
        } else if (RETRY_CODES.has(res.code)) {
          setTimeout(() => {
            if (gen === this.generation && this.socket.connected) this.emitBatch(chunk);
          }, 1_000);
        } else {
          // all-or-nothing failed: send one by one so only the bad op is rejected
          for (const p of chunk) this.emitOp(p);
        }
      })
      .catch(() => {
        for (const p of chunk) this.inFlight.delete(p.opId);
      });
  }

  /** Joined over a live socket: ops leave right away instead of waiting in the queue. */
  get online(): boolean {
    return this.socket.connected && this.joined;
  }

  /**
   * Several local edits as one action (multi-move, eraser sweep, undo…): sent as
   * `element:batch` chunks of ≤ 50 ops. All or nothing — offline, an action that doesn't fit
   * the queue's remaining room is refused whole (null) and nothing is queued.
   */
  sendMany(ops: LocalOp[]): string[] | null {
    if (!this.boardId) return null;
    const boardId = this.boardId;
    const list = ops.map((op): PendingOp => ({ opId: uuid(), boardId, op }));
    if (!useBoardStore.getState().localMany(list, this.online)) return null;
    if (this.online) this.emitAll(list);
    return list.map((p) => p.opId);
  }

  // ---- ops -------------------------------------------------------------------------------

  /** A local edit. Returns its opId, or null when the offline queue is full (edits blocked). */
  send(op: LocalOp): string | null {
    if (!this.boardId) return null;
    const pending: PendingOp = { opId: uuid(), boardId: this.boardId, op };
    if (!useBoardStore.getState().local(pending)) return null;
    if (this.online) this.emitOp(pending);
    return pending.opId;
  }

  private emitOp(p: PendingOp) {
    if (this.inFlight.get(p.opId) === this.generation) return;
    this.inFlight.set(p.opId, this.generation);
    const gen = this.generation;
    const { event, payload } = toWire(p);
    (
      this.socket.timeout(ACK_TIMEOUT_MS) as unknown as {
        emitWithAck: (e: string, p: unknown) => Promise<AnyAck>;
      }
    )
      .emitWithAck(event, payload)
      .then((res) => {
        this.inFlight.delete(p.opId);
        if (res.ok) {
          useBoardStore.getState().ack(p.opId, (res.data as { seq: number }).seq);
        } else if (RETRY_CODES.has(res.code)) {
          setTimeout(() => {
            if (gen === this.generation && this.socket.connected) this.emitOp(p);
          }, 1_000);
        } else {
          useBoardStore.getState().reject(p.opId);
          this.cb.onReject(res.message);
        }
      })
      .catch(() => {
        // ack timed out (likely disconnected): keep pending — resent after the next resync
        this.inFlight.delete(p.opId);
      });
  }

  // ---- presence & ephemeral --------------------------------------------------------------

  private heartbeat() {
    if (!this.socket.connected || !this.joined) return;
    this.socket.emit(
      'presence:heartbeat',
      { roomId: this.roomId, boardId: this.boardId, idle: this.idle },
      () => undefined,
    );
  }

  private checkIdle() {
    const idle = Date.now() - this.lastInput > IDLE_AFTER_MS;
    if (idle !== this.idle) {
      this.idle = idle;
      this.heartbeat();
    }
  }

  /** Throttled to 20 Hz; the last position always gets sent. */
  cursor(x: number, y: number) {
    this.pendingCursor = { x: Math.round(x), y: Math.round(y) };
    const wait = this.lastCursor + CURSOR_INTERVAL_MS - Date.now();
    if (wait <= 0) this.sendCursor();
    else
      this.cursorTimer ??= setTimeout(() => {
        this.cursorTimer = null;
        this.sendCursor();
      }, wait);
  }

  private sendCursor() {
    const c = this.pendingCursor;
    if (!c || !this.boardId || !this.socket.connected) return;
    this.pendingCursor = null;
    this.lastCursor = Date.now();
    this.socket.volatile.emit('cursor:move', { boardId: this.boardId, x: c.x, y: c.y });
  }

  /** `stroke:preview` (throttling and chunking happen in the tools' PreviewSender) */
  strokePreview(tempId: string, points: Pt[], style: Style) {
    if (!this.boardId || !this.socket.connected || !this.joined || points.length === 0) return;
    this.socket.volatile.emit('stroke:preview', {
      boardId: this.boardId,
      tempId,
      points: points.map(([x, y]): [number, number] => [x, y]),
      style,
    });
  }

  get activeBoardId() {
    return this.boardId;
  }

  // ---- server events ---------------------------------------------------------------------

  private on<E extends keyof ServerToClientEvents | 'connect'>(
    event: E,
    fn: E extends keyof ServerToClientEvents ? ServerToClientEvents[E] : () => void,
  ) {
    (this.socket.on as (e: string, f: unknown) => void)(event, fn);
    this.offs.push(() => {
      (this.socket.off as (e: string, f: unknown) => void)(event, fn);
    });
  }

  private updateRoom(fn: (prev: RoomDetailResponse) => RoomDetailResponse) {
    this.queryClient.setQueryData<RoomDetailResponse>(keys.room(this.roomId), (prev) =>
      prev ? fn(prev) : prev,
    );
  }

  private listen() {
    this.on('connect', () => void this.onConnect());
    this.on('board:op', (op) => {
      useBoardStore.getState().remote(op);
      // the drawer's committed element replaces their ghost
      if (op.op.kind === 'element:upsert' && op.actorId)
        usePresenceStore.getState().dropGhost(op.actorId);
      this.watchGap();
    });
    this.on('board:reset', ({ boardId }) => {
      if (boardId === this.boardId) void this.subscribe(false);
    });
    this.on('presence:update', ({ roomId, users }) => {
      if (roomId === this.roomId) usePresenceStore.getState().setUsers(roomId, users);
    });
    this.on('cursor:move', (c) => {
      if (c.boardId === this.boardId) usePresenceStore.getState().moveCursor(c);
    });
    this.on('stroke:preview', ({ userId, boardId, tempId, points, style }) => {
      if (boardId !== this.boardId || userId === this.meId) return;
      usePresenceStore.getState().previewGhost({ userId, tempId, points, style });
    });
    this.on('board:created', ({ board }) => {
      this.updateRoom((p) =>
        p.boards.some((b) => b.id === board.id) ? p : { ...p, boards: [...p.boards, board] },
      );
    });
    this.on('board:updated', ({ board }) => {
      // a move re-sequences everyone, so refetch positions; renames patch in place
      this.updateRoom((p) => ({
        ...p,
        boards: p.boards.map((b) => (b.id === board.id ? board : b)),
      }));
      void this.queryClient.invalidateQueries({ queryKey: keys.room(this.roomId) });
    });
    this.on('board:deleted', ({ boardId }) => {
      let fallback: Board | undefined;
      this.updateRoom((p) => {
        const boards = p.boards.filter((b) => b.id !== boardId);
        fallback = boards[0];
        return { ...p, boards };
      });
      if (boardId === this.boardId) this.cb.onActiveBoardDeleted(fallback);
    });
    this.on('member:joined', ({ member }) => {
      this.updateRoom((p) => ({
        ...p,
        members: p.members.some((m) => m.user.id === member.user.id)
          ? p.members
          : [...p.members, member],
      }));
    });
    const removeMember = (userId: string) => {
      this.updateRoom((p) => ({ ...p, members: p.members.filter((m) => m.user.id !== userId) }));
    };
    this.on('member:left', ({ userId }) => {
      removeMember(userId);
    });
    this.on('member:kicked', ({ userId }) => {
      if (userId === this.meId) this.cb.onKicked();
      else removeMember(userId);
    });
    this.on('member:roleChanged', ({ userId, role }) => {
      this.updateRoom((p) => ({
        ...p,
        room: userId === this.meId ? { ...p.room, role } : p.room,
        members: p.members.map((m) => (m.user.id === userId ? { ...m, role } : m)),
      }));
      if (userId === this.meId) this.cb.onRoleChanged(role);
    });
    this.on('room:updated', ({ room }) => {
      this.updateRoom((p) => ({ ...p, room: { ...room, role: p.room.role } })); // role is per-viewer
    });
    this.on('room:deleted', ({ roomId }) => {
      if (roomId === this.roomId) this.cb.onRoomDeleted();
    });
  }

  /** A seq gap that doesn't close by itself within 2 s → delta resync. */
  private watchGap() {
    if (this.gapTimer || !hasGap(useBoardStore.getState())) return;
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      if (hasGap(useBoardStore.getState())) void this.subscribe(true);
    }, GAP_RESYNC_MS);
  }
}
