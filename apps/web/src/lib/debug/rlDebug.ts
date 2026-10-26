/**
 * Dev / E2E-only debug hook (`window.__rlDebug`). Only ever reached through a dynamic import
 * behind a build-time constant (see RoomWorkspace), so production bundles don't contain it.
 */
import { MAPS, MARKER_KINDS, type ElementInput, type MapId } from '@rotationlab/shared';
import { v7 as uuid } from 'uuid';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { getSocket } from '@/lib/realtime/socket';
import { useBoardStore } from '@/stores/boardStore';
import { useLaserStore } from '@/stores/laserStore';
import { useSelectionStore } from '@/stores/selectionStore';

const COLORS = ['#F2A900', '#EF4444', '#22C55E', '#38BDF8', '#EC4899', '#F8FAFC'] as const;
const TYPES = ['STROKE', 'LINE', 'ARROW', 'CIRCLE', 'POLYGON', 'TEXT', 'MARKER'] as const;

export interface RlDebug {
  addRandomElements(n: number): number;
  moveElement(id?: string): string | null;
  deleteAll(): number;
  count(): number;
  ids(): string[];
  geometry(id: string): unknown;
  pending(): number;
  lastSeq(): number;
  /** the active board is subscribed and has layers */
  ready(): boolean;
  /** the board's elements (view), compact */
  elements(): { id: string; type: string; layerId: string; geometry: unknown; props: unknown }[];
  layers(): { id: string; name: string; position: number; visible: boolean; locked: boolean }[];
  selection(): string[];
  history(): { undo: number; redo: number };
  /** a raw socket emit with ack — to prove the server rejects what the UI hides (E2E-5) */
  emit(event: string, payload: unknown): Promise<unknown>;
  /** user ids with a live laser trail on this board */
  laserUsers(): string[];
}

declare global {
  interface Window {
    __rlDebug?: RlDebug;
  }
}

/** `xs[i mod n]` — lists here are non-empty constants */
function pick<T>(xs: readonly T[], i: number): T {
  const x = xs[i % xs.length];
  if (x === undefined) throw new Error('pick from an empty list');
  return x;
}

function randomElement(boardId: string, layerId: string, mapId: MapId, i: number): ElementInput {
  const W = MAPS[mapId].worldSize;
  const r = (lo: number, hi: number) => Math.round(lo + Math.random() * (hi - lo));
  const pt = (): [number, number] => [r(20_000, W - 20_000), r(20_000, W - 20_000)];
  const near = ([x, y]: [number, number], d: number): [number, number] => [
    Math.min(W, Math.max(0, x + r(-d, d))),
    Math.min(W, Math.max(0, y + r(-d, d))),
  ];
  const type = pick(TYPES, i);
  const base = {
    id: uuid(),
    boardId,
    layerId,
    style: {
      color: pick(COLORS, i),
      width: pick([2, 4, 7] as const, i),
      dashed: i % 5 === 0,
      fillOpacity: 0.15,
    },
    z: 0,
  };
  const start = pt();
  switch (type) {
    case 'STROKE': {
      const pts: [number, number][] = [start];
      let last = start;
      for (let k = 0; k < 12; k++) pts.push((last = near(last, 8000)));
      return { ...base, type, geometry: { points: pts }, props: {} };
    }
    case 'LINE':
      return { ...base, type, geometry: { points: [start, near(start, 60_000)] }, props: {} };
    case 'ARROW':
      return {
        ...base,
        type,
        geometry: { points: [start, near(start, 40_000), near(start, 80_000)] },
        props: {},
      };
    case 'CIRCLE':
      return { ...base, type, geometry: { center: start, r: r(5_000, 60_000) }, props: {} };
    case 'POLYGON':
      return {
        ...base,
        type,
        geometry: {
          points: [start, near(start, 30_000), near(start, 30_000), near(start, 30_000)],
        },
        props: {},
      };
    case 'TEXT':
      return { ...base, type, geometry: { at: start }, props: { text: `Note ${i}`, size: 'md' } };
    case 'MARKER':
      return {
        ...base,
        type,
        geometry: { at: start },
        props: {
          kind: pick(MARKER_KINDS, i),
          number: (i % 25) + 1,
          label: `M${i}`,
        },
      };
  }
}

export function installRlDebug(session: RoomSession, mapId: MapId): () => void {
  const api: RlDebug = {
    addRandomElements(n) {
      const s = useBoardStore.getState();
      const layer = s.view.layers.find((l) => !l.locked && l.visible);
      if (!s.boardId || !layer) return 0;
      const boardId = s.boardId;
      return (
        session.sendMany(
          Array.from({ length: n }, (_, i) => ({
            kind: 'element:upsert' as const,
            element: randomElement(boardId, layer.id, mapId, i),
          })),
        )?.length ?? 0
      );
    },
    moveElement(id) {
      const s = useBoardStore.getState();
      const el = id ? s.view.elements[id] : Object.values(s.view.elements)[0];
      if (!el) return null;
      const W = MAPS[mapId].worldSize;
      const shift = (p: [number, number]): [number, number] => [
        Math.min(W, p[0] + 10_000),
        Math.min(W, p[1] + 10_000),
      ];
      const g = el.geometry as {
        points?: [number, number][];
        center?: [number, number];
        at?: [number, number];
        r?: number;
      };
      const geometry = g.points
        ? { points: g.points.map(shift) }
        : g.center
          ? { center: shift(g.center), r: g.r }
          : { at: shift(g.at ?? [0, 0]) };
      const { seq: _s, createdBy: _c, updatedBy: _u, updatedAt: _t, pending: _p, ...input } = el;
      session.send({ kind: 'element:upsert', element: { ...input, geometry } as ElementInput });
      return el.id;
    },
    deleteAll() {
      const ids = Object.keys(useBoardStore.getState().view.elements);
      return (
        session.sendMany(ids.map((elementId) => ({ kind: 'element:delete' as const, elementId })))
          ?.length ?? 0
      );
    },
    count: () => Object.keys(useBoardStore.getState().view.elements).length,
    ids: () => Object.keys(useBoardStore.getState().view.elements),
    geometry: (id) => useBoardStore.getState().view.elements[id]?.geometry,
    pending: () => useBoardStore.getState().pending.length,
    lastSeq: () => useBoardStore.getState().lastSeq,
    ready: () => {
      const s = useBoardStore.getState();
      return s.ready && s.view.layers.length > 0;
    },
    elements: () =>
      Object.values(useBoardStore.getState().view.elements).map((e) => ({
        id: e.id,
        type: e.type,
        layerId: e.layerId,
        geometry: e.geometry,
        props: e.props,
      })),
    layers: () =>
      useBoardStore.getState().view.layers.map((l) => ({
        id: l.id,
        name: l.name,
        position: l.position,
        visible: l.visible,
        locked: l.locked,
      })),
    selection: () => [...useSelectionStore.getState().ids],
    history: () => {
      const s = useBoardStore.getState();
      const h = s.boardId ? s.history[s.boardId] : undefined;
      return { undo: h?.undo.length ?? 0, redo: h?.redo.length ?? 0 };
    },
    laserUsers: () => Object.keys(useLaserStore.getState().trails),
    emit: (event, payload) =>
      (
        getSocket().timeout(5_000) as unknown as {
          emitWithAck: (e: string, p: unknown) => Promise<unknown>;
        }
      ).emitWithAck(event, payload),
  };
  window.__rlDebug = api;
  return () => {
    if (window.__rlDebug === api) delete window.__rlDebug;
  };
}
