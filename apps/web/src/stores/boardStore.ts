'use client';

import type { BoardOp, BoardSubscribeAck } from '@rotationlab/shared';
import { current, enableMapSet, isDraft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ackOp,
  addLocal,
  addLocalMany,
  applyDelta,
  applyRemote,
  emptyModel,
  loadFull,
  MAX_PENDING,
  popHistory,
  pushHistory,
  rejectOp,
  type BoardModel,
  type HistoryStep,
  type PendingOp,
} from './boardModel';

enableMapSet();

interface BoardActions {
  setMe: (meId: string) => void;
  /** switching boards: drop confirmed state, keep the cross-board pending queue */
  switchBoard: (boardId: string) => void;
  subscribed: (boardId: string, ack: BoardSubscribeAck) => void;
  remote: (op: BoardOp) => void;
  local: (op: PendingOp) => boolean;
  /** all or nothing (bulk-op rule) */
  localMany: (ops: PendingOp[], online: boolean) => boolean;
  pushHistory: (boardId: string, step: HistoryStep, kind: 'action' | 'undo' | 'redo') => void;
  popHistory: (boardId: string, dir: 'undo' | 'redo') => HistoryStep | undefined;
  ack: (opId: string, seq: number) => void;
  reject: (opId: string) => PendingOp | undefined;
  reset: () => void;
}

export type BoardStore = BoardModel & BoardActions;

/** Zustand + immer wrapper around the pure board model (see boardModel.ts). */
export const useBoardStore = create<BoardStore>()(
  immer((set) => ({
    ...emptyModel(),
    setMe: (meId) => {
      set((s) => {
        s.meId = meId;
      });
    },
    switchBoard: (boardId) => {
      set((s) => {
        if (s.boardId === boardId) return;
        s.boardId = boardId;
        s.ready = false;
        s.lastSeq = 0;
        s.seenAbove = [];
        s.elements = {};
        s.layers = {};
        s.tombstones = {};
        s.orderSeq = 0;
        s.view = { elements: {}, layers: [] };
      });
    },
    subscribed: (boardId, ack) => {
      set((s) => {
        if (ack.mode === 'full') loadFull(s, boardId, ack);
        else if (s.boardId === boardId) applyDelta(s, ack);
      });
    },
    remote: (op) => {
      set((s) => {
        applyRemote(s, op);
      });
    },
    local: (op) => {
      let ok = false;
      set((s) => {
        ok = addLocal(s, op);
      });
      return ok;
    },
    localMany: (ops, online) => {
      let ok = false;
      set((s) => {
        ok = addLocalMany(s, ops, online);
      });
      return ok;
    },
    pushHistory: (boardId, step, kind) => {
      set((s) => {
        pushHistory(s, boardId, step, kind);
      });
    },
    popHistory: (boardId, dir) => {
      let step: HistoryStep | undefined;
      set((s) => {
        const popped = popHistory(s, boardId, dir);
        step = popped && isDraft(popped) ? current(popped) : popped; // plain object, out of the draft
      });
      return step;
    },
    ack: (opId, seq) => {
      set((s) => {
        ackOp(s, opId, seq);
      });
    },
    reject: (opId) => {
      let dropped: PendingOp | undefined;
      set((s) => {
        dropped = rejectOp(s, opId);
      });
      return dropped;
    },
    reset: () => {
      set((s) => ({ ...emptyModel(s.meId) }));
    },
  })),
);

/** Edits are blocked once the offline queue is full (UI shows the offline banner). */
export const selectQueueFull = (s: BoardModel) => s.pending.length >= MAX_PENDING;
export const selectPendingCount = (s: BoardModel) => s.pending.length;
