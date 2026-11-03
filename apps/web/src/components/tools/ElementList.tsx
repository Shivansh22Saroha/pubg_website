'use client';

import {
  MAPS,
  can,
  elementAnchor,
  gridRef,
  lootItem,
  type Board,
  type Member,
  type MarkerKind,
  type RoomRole,
} from '@rotationlab/shared';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { editorActions, makeNameOf, type EditSink } from '@/lib/editing';
import type { ViewElement } from '@/stores/boardModel';
import { linkedLabel } from '@/lib/linkedPlayers';
import { useBoardStore } from '@/stores/boardStore';
import { usePlayersStore } from '@/stores/playersStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useToolStore } from '@/stores/toolStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { deleteChanges } from './scene';
import { MARKER_LABELS } from './Toolbar';

const TYPE_NAMES: Record<ViewElement['type'], string> = {
  STROKE: 'Pen stroke',
  LINE: 'Line',
  ARROW: 'Arrow',
  CIRCLE: 'Circle',
  POLYGON: 'Polygon',
  TEXT: 'Text',
  MARKER: 'Marker',
};

/**
 * What a screen reader hears for an element: its text, or the marker's kind, number, label —
 * a linked own-player marker's label is its member's IGN (Phase 12).
 */
export function elementLabel(
  el: Pick<ViewElement, 'type' | 'props'>,
  names: Readonly<Record<string, string>> = {},
): string {
  const p = el.props as { text?: string; kind?: MarkerKind; number?: number; label?: string };
  if (el.type === 'TEXT') return p.text ?? '';
  if (el.type === 'MARKER') {
    const kind = p.kind ? MARKER_LABELS[p.kind] : 'Marker';
    const label = linkedLabel(el, names) ?? p.label;
    const item = lootItem((el.props as { item?: unknown }).item)?.name; // Phase 12 loot
    return [kind, item, p.number, label].filter((x) => x !== undefined && x !== '').join(' ');
  }
  return '';
}

const PAGE = 100;

/** "F-M 4,7" for an element, '' when it has no position on the map. */
export function elementLocation(el: Pick<ViewElement, 'geometry'>, worldSize: number): string {
  const at = elementAnchor(el.geometry);
  return at ? (gridRef(at, worldSize)?.label ?? '') : '';
}

/**
 * Element list (UI_UX_SPEC §10, P2): the board as a table — type, label, location, layer,
 * author — for keyboard and screen-reader users. **Show** (every role) centres the map on the
 * element like a ping chip; Select and Delete follow the map's rules (Editor+, unlocked layers).
 */
export function ElementList({
  role,
  session,
  members,
  meId,
  boards,
}: {
  role: RoomRole;
  session: EditSink | null;
  members: Member[];
  meId: string;
  /** the room's boards — the active one's map gives grid refs */
  boards: Board[];
}) {
  const elements = useBoardStore((s) => s.view.elements);
  const boardId = useBoardStore((s) => s.boardId);
  const mapId = boards.find((b) => b.id === boardId)?.mapId;
  const worldSize = mapId ? MAPS[mapId].worldSize : null;
  const layers = useBoardStore((s) => s.view.layers);
  const selected = useSelectionStore((s) => s.ids);
  const playerNames = usePlayersStore((s) => s.byId);
  const [limit, setLimit] = useState(PAGE);
  const nameOf = useMemo(
    () => makeNameOf(meId, Object.fromEntries(members.map((m) => [m.user.id, m.user.displayName]))),
    [members, meId],
  );
  const byLayer = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  // top-most layer first (like the layers list), then newest on top within a layer
  const rows = useMemo(
    () =>
      Object.values(elements).sort(
        (a, b) =>
          (byLayer.get(b.layerId)?.position ?? 0) - (byLayer.get(a.layerId)?.position ?? 0) ||
          b.z - a.z ||
          b.seq - a.seq,
      ),
    [elements, byLayer],
  );
  const edit = can(role, 'board.edit');

  if (rows.length === 0) {
    return <p className="px-2 py-4 text-sm text-text-muted">No elements on this board yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed text-left text-xs" data-testid="element-list">
        <caption className="sr-only">Elements on this board ({rows.length})</caption>
        <thead className="text-text-muted">
          <tr>
            <th scope="col" className="w-[17%] px-1 py-1 font-medium">
              Type
            </th>
            <th scope="col" className="px-1 py-1 font-medium">
              Label
            </th>
            <th scope="col" className="w-[17%] px-1 py-1 font-medium">
              Location
            </th>
            <th scope="col" className="w-[14%] px-1 py-1 font-medium">
              Layer
            </th>
            <th scope="col" className="w-[13%] px-1 py-1 font-medium">
              Author
            </th>
            <th scope="col" className="w-[24%] px-1 py-1 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((el) => {
            const layer = byLayer.get(el.layerId);
            const label = elementLabel(el, playerNames) || '—';
            const name = `${TYPE_NAMES[el.type]} ${label === '—' ? '' : label}`.trim();
            const canDelete = edit && layer !== undefined && !layer.locked;
            const isSelected = selected.includes(el.id);
            const at = elementAnchor(el.geometry);
            const where = worldSize ? elementLocation(el, worldSize) : '';
            return (
              <tr key={el.id} className="border-t">
                <td className="truncate px-1 py-1">{TYPE_NAMES[el.type]}</td>
                <td className="truncate px-1 py-1">{label}</td>
                <td className="truncate px-1 py-1 font-mono" data-testid="element-location">
                  {where}
                </td>
                <td className="truncate px-1 py-1">
                  {layer?.name ?? ''}
                  {layer?.locked && <span className="sr-only"> (locked)</span>}
                </td>
                <td className="truncate px-1 py-1">{nameOf(el.createdBy)}</td>
                <td className="px-1 py-1">
                  <span className="flex justify-end gap-1">
                    {at && boardId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        aria-label={`Show ${name}${where ? ` at ${where}` : ''} on the map`}
                        onClick={() => {
                          useWorkspaceStore
                            .getState()
                            .requestFocus({ boardId, x: at[0], y: at[1] });
                        }}
                      >
                        Show
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      aria-label={`Select ${name}`}
                      aria-pressed={isSelected}
                      disabled={!canDelete}
                      onClick={() => {
                        useToolStore.getState().setTool('select');
                        useSelectionStore.getState().select([el.id]);
                      }}
                    >
                      Select
                    </Button>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-danger"
                        aria-label={`Delete ${name}`}
                        onClick={() => {
                          const actions = editorActions(session, nameOf);
                          if (actions.commit(deleteChanges(elements, [el.id])))
                            useSelectionStore
                              .getState()
                              .select(
                                useSelectionStore.getState().ids.filter((id) => id !== el.id),
                              );
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLimit((n) => n + PAGE);
          }}
        >
          Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}
        </Button>
      )}
    </div>
  );
}
