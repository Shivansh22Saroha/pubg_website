'use client';

import {
  DRAWING_PALETTE,
  ROOM_LIMITS,
  SNAPSHOT_LIMITS,
  type Layer,
  type LayerInput,
  type RoomRole,
} from '@rotationlab/shared';
import {
  EllipsisVertical,
  Eye,
  EyeClosed,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  Plus,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v7 as uuid } from 'uuid';
import { safeColor } from '@/components/map/markerDom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LocalOp } from '@/stores/boardModel';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/boardStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useToolStore } from '@/stores/toolStore';
import { layerPermissions, resolveActiveLayer } from './gating';

/** What the panel sends layer ops through (RoomSession). */
export interface LayerSink {
  send(op: LocalOp): string | null;
}

const toInput = (l: Layer): LayerInput => ({
  id: l.id,
  name: l.name,
  color: l.color,
  visible: l.visible,
  locked: l.locked,
});

type Confirm = { kind: 'delete' | 'clear'; layer: Layer; count: number };

/**
 * Layers tab (UI_UX_SPEC §3.5, FEATURES F5). Rows list the top-most layer first (the order
 * they're drawn in, reversed). Click a row = active layer (local). Eye = board-wide visibility
 * (Editor+; Alt+click = hide for me only). Lock = owner only. Drag the handle to reorder.
 */
export function LayersPanel({ role, session }: { role: RoomRole; session: LayerSink | null }) {
  const layers = useBoardStore((s) => s.view.layers);
  const ready = useBoardStore((s) => s.ready);
  const elements = useBoardStore((s) => s.view.elements);
  const picked = useToolStore((s) => s.activeLayerId);
  const setActive = useToolStore((s) => s.setActiveLayer);
  const hidden = useSelectionStore((s) => s.hiddenLayers);
  const toggleHidden = useSelectionStore((s) => s.toggleHidden);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [coloring, setColoring] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const rows = useMemo(() => [...layers].sort((a, b) => b.position - a.position), [layers]);
  const active = resolveActiveLayer(layers, picked);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const el of Object.values(elements)) c[el.layerId] = (c[el.layerId] ?? 0) + 1;
    return c;
  }, [elements]);
  const canAdd = layerPermissions(role, { locked: false }, layers.length).reorder;

  const send = (op: LocalOp) => {
    if (!session?.send(op)) toast.error('Too many unsynced changes — reconnect first');
  };
  const upsert = (l: Layer, patch: Partial<LayerInput>) => {
    send({ kind: 'layer:upsert', layer: { ...toInput(l), ...patch } });
  };

  if (!ready) return <p className="p-2 text-sm text-text-muted">Loading layers…</p>;

  const addLayer = () => {
    if (layers.length >= ROOM_LIMITS.maxLayers) return;
    const used = new Set(layers.map((l) => l.color.toUpperCase()));
    const color = DRAWING_PALETTE.find((c) => !used.has(c)) ?? DRAWING_PALETTE[0];
    const id = uuid();
    send({
      kind: 'layer:upsert',
      layer: { id, name: `Layer ${layers.length + 1}`, color, visible: true, locked: false },
    });
    setActive(id);
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = rows.map((l) => l.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    // rows are top-most first; positions count from the bottom
    send({ kind: 'layer:reorder', order: [...ids].reverse() });
  };

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col" aria-label="Layers" data-testid="layers-list">
        {rows.map((l) => {
          const perm = layerPermissions(role, l, layers.length);
          const isActive = active?.id === l.id;
          const localHidden = Boolean(hidden[l.id]);
          return (
            <li
              key={l.id}
              data-testid="layer-row"
              data-layer={l.name}
              data-active={isActive}
              data-visible={l.visible}
              data-local-hidden={localHidden}
              data-locked={l.locked}
              draggable={perm.reorder && renaming !== l.id}
              onDragStart={(e) => {
                setDragId(l.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', l.id);
              }}
              onDragEnd={() => {
                setDragId(null);
              }}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(l.id);
                setDragId(null);
              }}
              className={cn(
                'flex flex-col rounded-control text-sm',
                isActive ? 'bg-surface-2 ring-1 ring-accent/60' : 'hover:bg-surface-2',
                dragId === l.id && 'opacity-50',
              )}
            >
              <div className="flex items-center gap-1.5 px-1.5 py-1.5">
                {perm.reorder ? (
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-text-muted"
                    aria-label="Drag to reorder"
                    data-testid="layer-drag"
                  />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                {/* colour validated as #RRGGBB (SECURITY V5) */}
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: safeColor(l.color) }}
                />
                {renaming === l.id ? (
                  <input
                    autoFocus
                    aria-label="Layer name"
                    defaultValue={l.name}
                    maxLength={32}
                    className="h-7 min-w-0 flex-1 rounded-control border bg-bg px-2 text-sm outline-none focus:ring-2 focus:ring-accent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim();
                      setRenaming(null);
                      if (name && name !== l.name) upsert(l, { name });
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    aria-pressed={isActive}
                    title={isActive ? 'Active layer — new elements go here' : 'Make active'}
                    onClick={() => {
                      setActive(l.id);
                    }}
                    onDoubleClick={() => {
                      if (perm.rename) setRenaming(l.id);
                    }}
                  >
                    {l.name}
                    <span className="ml-1 text-xs text-text-muted">{counts[l.id] ?? 0}</span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid="layer-eye"
                  aria-label={
                    localHidden
                      ? `Show ${l.name} for me`
                      : l.visible
                        ? `Hide ${l.name}`
                        : `Show ${l.name}`
                  }
                  title={
                    localHidden
                      ? 'Hidden for you only — Alt+click to show'
                      : `${l.visible ? 'Hide' : 'Show'} for everyone · Alt+click: hide for me only`
                  }
                  className={cn(
                    'rounded-control p-1 text-text-muted hover:bg-bg hover:text-text',
                    localHidden && 'text-accent',
                  )}
                  onClick={(e) => {
                    if (e.altKey || localHidden) {
                      toggleHidden(l.id);
                      return;
                    }
                    if (!perm.toggleVisible) {
                      toast(
                        l.locked
                          ? 'Only the owner can change a locked layer — Alt+click hides it for you'
                          : 'Viewers can only hide layers for themselves (Alt+click)',
                      );
                      return;
                    }
                    upsert(l, { visible: !l.visible });
                  }}
                >
                  {localHidden ? (
                    <EyeClosed className="size-4" aria-hidden />
                  ) : l.visible ? (
                    <Eye className="size-4" aria-hidden />
                  ) : (
                    <EyeOff className="size-4" aria-hidden />
                  )}
                </button>
                {perm.toggleLock ? (
                  <button
                    type="button"
                    data-testid="layer-lock"
                    aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`}
                    aria-pressed={l.locked}
                    className="rounded-control p-1 text-text-muted hover:bg-bg hover:text-text"
                    onClick={() => {
                      upsert(l, { locked: !l.locked });
                    }}
                  >
                    {l.locked ? (
                      <Lock className="size-4" aria-hidden />
                    ) : (
                      <LockOpen className="size-4 opacity-50" aria-hidden />
                    )}
                  </button>
                ) : (
                  <span
                    data-testid="layer-lock-readonly"
                    role="img"
                    aria-label={l.locked ? 'Locked by the owner' : 'Unlocked'}
                    title={l.locked ? 'Locked by the owner' : 'Only the owner can lock layers'}
                    className="p-1 text-text-muted"
                  >
                    {l.locked ? (
                      <Lock className="size-4" aria-hidden />
                    ) : (
                      <LockOpen className="size-4 opacity-30" aria-hidden />
                    )}
                  </span>
                )}
                {(perm.rename || perm.clear || perm.delete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`${l.name} options`}
                      data-testid="layer-menu"
                      className="rounded-control p-1 text-text-muted hover:bg-bg hover:text-text"
                    >
                      <EllipsisVertical className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {perm.rename && (
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenaming(l.id);
                          }}
                        >
                          Rename
                        </DropdownMenuItem>
                      )}
                      {perm.recolor && (
                        <DropdownMenuItem
                          onSelect={() => {
                            setColoring(coloring === l.id ? null : l.id);
                          }}
                        >
                          Change colour
                        </DropdownMenuItem>
                      )}
                      {perm.clear && (
                        <DropdownMenuItem
                          onSelect={() => {
                            setConfirm({ kind: 'clear', layer: l, count: counts[l.id] ?? 0 });
                          }}
                        >
                          Clear layer
                        </DropdownMenuItem>
                      )}
                      {perm.delete && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            destructive
                            onSelect={() => {
                              setConfirm({ kind: 'delete', layer: l, count: counts[l.id] ?? 0 });
                            }}
                          >
                            Delete layer
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {coloring === l.id && (
                <div
                  className="flex flex-wrap gap-1 px-7 pb-2"
                  role="group"
                  aria-label="Layer colour"
                >
                  {DRAWING_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      aria-pressed={l.color.toUpperCase() === c}
                      className={cn(
                        'size-5 rounded-full border-2 border-transparent',
                        l.color.toUpperCase() === c && 'border-text',
                      )}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setColoring(null);
                        if (l.color.toUpperCase() !== c) upsert(l, { color: c });
                      }}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canAdd && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          disabled={layers.length >= ROOM_LIMITS.maxLayers}
          title={
            layers.length >= ROOM_LIMITS.maxLayers
              ? `A board can have at most ${ROOM_LIMITS.maxLayers} layers`
              : undefined
          }
          onClick={addLayer}
        >
          <Plus className="size-4" aria-hidden /> Add layer
        </Button>
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      >
        {confirm && (
          <DialogContent
            title={confirm.kind === 'delete' ? 'Delete layer' : 'Clear layer'}
            description={
              confirm.kind === 'delete'
                ? `“${confirm.layer.name}” and its ${confirm.count} element${confirm.count === 1 ? '' : 's'} will be deleted for everyone.`
                : `All ${confirm.count} element${confirm.count === 1 ? '' : 's'} on “${confirm.layer.name}” will be removed for everyone. ${
                    confirm.count > SNAPSHOT_LIMITS.clearAutoThreshold
                      ? 'An automatic snapshot will be saved first.'
                      : 'This can’t be undone.'
                  }`
            }
          >
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirm(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                data-testid="confirm-layer-action"
                onClick={() => {
                  const { kind, layer } = confirm;
                  setConfirm(null);
                  // > 50 elements: the server saves an auto snapshot first (FEATURES F10)
                  send({
                    kind: kind === 'delete' ? 'layer:delete' : 'layer:clear',
                    layerId: layer.id,
                  });
                }}
              >
                {confirm.kind === 'delete' ? 'Delete' : 'Clear'}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
