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
import { LocateFixed, MousePointer2, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { editorActions, makeNameOf, type EditSink } from '@/lib/editing';
import type { ViewElement } from '@/stores/boardModel';
import { linkedLabel } from '@/lib/linkedPlayers';
import { useBoardStore } from '@/stores/boardStore';
import { usePlayersStore } from '@/stores/playersStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useToolStore } from '@/stores/toolStore';
import { cn } from '@/lib/utils';
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

/** a 28 px icon button (44 px on touch); the accessible name says what and where */
function IconAction({
  label,
  title,
  pressed,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string;
  title: string;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-surface-2 text-accent',
        danger && 'text-danger hover:text-danger',
      )}
    >
      {children}
    </button>
  );
}

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
      {/* two columns so it fits the 300 px side panel: what + where on two lines, then icon
          actions (their accessible names carry the full description) */}
      <table className="w-full table-fixed text-left text-xs" data-testid="element-list">
        <caption className="sr-only">Elements on this board ({rows.length})</caption>
        <thead className="text-text-muted">
          <tr>
            <th scope="col" className="px-1 py-1 font-medium">
              Element <span className="font-normal">· location · layer · author</span>
            </th>
            <th scope="col" className="w-[6.5rem] px-1 py-1 font-medium pointer-coarse:w-[8.5rem]">
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
            const author = nameOf(el.createdBy);
            return (
              <tr key={el.id} className="border-t align-top">
                <td className="min-w-0 px-1 py-1.5">
                  <p className="truncate" title={name}>
                    <span className="font-medium text-text">{TYPE_NAMES[el.type]}</span>
                    {label !== '—' && <span className="text-text"> {label}</span>}
                  </p>
                  <p className="truncate text-text-muted">
                    {where && (
                      <span className="font-mono" data-testid="element-location">
                        {where}
                      </span>
                    )}
                    {where && ' · '}
                    {layer?.name ?? ''}
                    {layer?.locked && ' (locked)'}
                    {' · '}
                    {author}
                  </p>
                </td>
                <td className="px-1 py-1.5">
                  <span className="flex justify-end gap-0.5">
                    {at && boardId && (
                      <IconAction
                        label={`Show ${name}${where ? ` at ${where}` : ''} on the map`}
                        title="Show on map"
                        onClick={() => {
                          useWorkspaceStore
                            .getState()
                            .requestFocus({ boardId, x: at[0], y: at[1] });
                        }}
                      >
                        <LocateFixed className="size-4" aria-hidden />
                      </IconAction>
                    )}
                    <IconAction
                      label={`Select ${name}`}
                      title="Select"
                      pressed={isSelected}
                      disabled={!canDelete}
                      onClick={() => {
                        useToolStore.getState().setTool('select');
                        useSelectionStore.getState().select([el.id]);
                      }}
                    >
                      <MousePointer2 className="size-4" aria-hidden />
                    </IconAction>
                    {canDelete && (
                      <IconAction
                        label={`Delete ${name}`}
                        title="Delete"
                        danger
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
                        <Trash2 className="size-4" aria-hidden />
                      </IconAction>
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
