'use client';

import { can, MAPS, type Board, type MapId, type RoomRole } from '@rotationlab/shared';
import { MapIcon, MoreVertical, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MapPicker } from '@/components/rooms/bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useCreateBoard, useDeleteBoard, useUpdateBoard } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { usePresenceStore } from '@/stores/presenceStore';

type DialogState =
  { kind: 'new' } | { kind: 'rename'; board: Board } | { kind: 'delete'; board: Board } | null;

/** Default name "{Map} – Plan {n}" (FEATURES F4). */
function defaultName(mapId: MapId, boards: Board[]) {
  const n = boards.filter((b) => b.mapId === mapId).length + 1;
  return `${MAPS[mapId].name} – Plan ${n}`;
}

/** UI_UX_SPEC §3.5 board tabs: select, + new, kebab (rename/duplicate/delete), drag to reorder. */
export function BoardTabs({
  roomId,
  role,
  boards,
  activeId,
  onSelect,
}: {
  roomId: string;
  role: RoomRole;
  boards: Board[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState('');
  const [mapId, setMapId] = useState<MapId>('erangel');
  const [dragId, setDragId] = useState<string | null>(null);
  const create = useCreateBoard(roomId);
  const update = useUpdateBoard(roomId);
  const remove = useDeleteBoard(roomId);
  const canManage = can(role, 'board.manage');
  const canDelete = can(role, 'board.delete');
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong');

  const close = () => {
    setDialog(null);
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Boards"
        className="flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {boards.map((b, i) => {
          const active = b.id === activeId;
          return (
            <div
              key={b.id}
              className={cn(
                'group flex shrink-0 items-center border-r',
                active ? 'bg-surface shadow-[inset_0_-2px_0_var(--accent)]' : 'hover:bg-surface',
                dragId && dragId !== b.id && 'data-[over=true]:bg-surface-2',
              )}
              draggable={canManage}
              onDragStart={(e) => {
                setDragId(b.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
              }}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== b.id) {
                  update.mutate({ boardId: dragId, position: i }, { onError: fail });
                }
                setDragId(null);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={`${b.name} (${MAPS[b.mapId].name}) — ${i < 9 ? `press ${i + 1}` : ''}`}
                onClick={() => {
                  onSelect(b.id);
                }}
                className={cn(
                  'flex h-12 items-center gap-1.5 px-3 text-[13px]',
                  active ? 'text-text' : 'text-text-muted',
                )}
              >
                <MapIcon className="size-3.5" aria-hidden />
                <span className="max-w-40 truncate">{b.name}</span>
                <BoardPresenceDots boardId={b.id} />
              </button>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Board actions for ${b.name}`}
                    className="mr-1 rounded-control p-1 text-text-muted opacity-60 hover:bg-surface-2 hover:opacity-100"
                  >
                    <MoreVertical className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onSelect={() => {
                        setName(b.name);
                        setDialog({ kind: 'rename', board: b });
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        create.mutate(
                          {
                            name: `${b.name} (copy)`.slice(0, 40),
                            mapId: b.mapId,
                            duplicateFrom: b.id,
                          },
                          {
                            onSuccess: ({ board }) => {
                              onSelect(board.id);
                            },
                            onError: fail,
                          },
                        );
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                    {canDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          disabled={boards.length <= 1}
                          onSelect={() => {
                            setDialog({ kind: 'delete', board: b });
                          }}
                        >
                          Delete board
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        {canManage && (
          <button
            type="button"
            aria-label="New board"
            title="New board"
            onClick={() => {
              setMapId('erangel');
              setName(defaultName('erangel', boards));
              setDialog({ kind: 'new' });
            }}
            className="flex h-12 shrink-0 items-center px-3 text-text-muted hover:bg-surface hover:text-text"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        {dialog?.kind === 'new' && (
          <DialogContent title="New board">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(
                  { name, mapId },
                  {
                    onSuccess: ({ board }) => {
                      close();
                      onSelect(board.id);
                    },
                    onError: fail,
                  },
                );
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="board-name">Name</Label>
                <Input
                  id="board-name"
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </div>
              <MapPicker
                name="board-map"
                value={mapId}
                onChange={(m) => {
                  // keep the auto-generated name in sync until the user edits it
                  if (name === defaultName(mapId, boards)) setName(defaultName(m, boards));
                  setMapId(m);
                }}
              />
              <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
                Create board
              </Button>
            </form>
          </DialogContent>
        )}
        {dialog?.kind === 'rename' && (
          <DialogContent title="Rename board">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate(
                  { boardId: dialog.board.id, name },
                  { onSuccess: close, onError: fail },
                );
              }}
            >
              <Input
                aria-label="Board name"
                value={name}
                maxLength={40}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
              <Button type="submit" disabled={update.isPending || name.trim().length === 0}>
                Save
              </Button>
            </form>
          </DialogContent>
        )}
        {dialog?.kind === 'delete' && (
          <DialogContent
            title="Delete board"
            description={`"${dialog.board.name}" and everything drawn on it will be deleted.`}
          >
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(dialog.board.id, {
                    onSuccess: () => {
                      close();
                      const next = boards.find((b) => b.id !== dialog.board.id);
                      if (next && dialog.board.id === activeId) onSelect(next.id);
                    },
                    onError: fail,
                  });
                }}
              >
                Delete board
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** Small dots in the presence colours of everyone currently on this board (UI_UX_SPEC §3.5). */
function BoardPresenceDots({ boardId }: { boardId: string }) {
  const users = usePresenceStore((s) => s.users);
  const here = Object.values(users).filter((u) => u.boardId === boardId);
  if (here.length === 0) return null;
  return (
    <span
      className="flex -space-x-1"
      aria-label={`${here.length} here`}
      data-testid="board-presence"
    >
      {here.slice(0, 4).map((u) => (
        <span
          key={u.userId}
          className="size-2 rounded-full ring-1 ring-bg"
          style={{ backgroundColor: u.color }}
        />
      ))}
    </span>
  );
}
