'use client';

import { can, type Member, type MarkerKind, type RoomRole } from '@rotationlab/shared';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { editorActions, makeNameOf, type EditSink } from '@/lib/editing';
import type { ViewElement } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useToolStore } from '@/stores/toolStore';
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

/** What a screen reader hears for an element: its text, or the marker's kind, number, label. */
export function elementLabel(el: Pick<ViewElement, 'type' | 'props'>): string {
  const p = el.props as { text?: string; kind?: MarkerKind; number?: number; label?: string };
  if (el.type === 'TEXT') return p.text ?? '';
  if (el.type === 'MARKER') {
    const kind = p.kind ? MARKER_LABELS[p.kind] : 'Marker';
    return [kind, p.number, p.label].filter((x) => x !== undefined && x !== '').join(' ');
  }
  return '';
}

const PAGE = 100;

/**
 * Element list (UI_UX_SPEC §10, P2): the board as a table — type, label, layer, author — with
 * Select and Delete, for keyboard and screen-reader users. Same rules as the map: hidden-for-me
 * layers are listed but marked, locked layers can't be edited, viewers only select.
 */
export function ElementList({
  role,
  session,
  members,
  meId,
}: {
  role: RoomRole;
  session: EditSink | null;
  members: Member[];
  meId: string;
}) {
  const elements = useBoardStore((s) => s.view.elements);
  const layers = useBoardStore((s) => s.view.layers);
  const selected = useSelectionStore((s) => s.ids);
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
            <th scope="col" className="w-[22%] px-1 py-1 font-medium">
              Type
            </th>
            <th scope="col" className="px-1 py-1 font-medium">
              Label
            </th>
            <th scope="col" className="w-[20%] px-1 py-1 font-medium">
              Layer
            </th>
            <th scope="col" className="w-[18%] px-1 py-1 font-medium">
              Author
            </th>
            <th scope="col" className="w-[30%] px-1 py-1 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((el) => {
            const layer = byLayer.get(el.layerId);
            const label = elementLabel(el) || '—';
            const name = `${TYPE_NAMES[el.type]} ${label === '—' ? '' : label}`.trim();
            const canDelete = edit && layer !== undefined && !layer.locked;
            const isSelected = selected.includes(el.id);
            return (
              <tr key={el.id} className="border-t">
                <td className="truncate px-1 py-1">{TYPE_NAMES[el.type]}</td>
                <td className="truncate px-1 py-1">{label}</td>
                <td className="truncate px-1 py-1">
                  {layer?.name ?? ''}
                  {layer?.locked && <span className="sr-only"> (locked)</span>}
                </td>
                <td className="truncate px-1 py-1">{nameOf(el.createdBy)}</td>
                <td className="px-1 py-1">
                  <span className="flex justify-end gap-1">
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
