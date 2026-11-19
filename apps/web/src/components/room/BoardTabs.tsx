'use client';

import {
  can,
  CUSTOM_MAP_ID,
  CUSTOM_MAP_LIMITS,
  MAPS,
  type Board,
  type RoomRole,
} from '@rotationlab/shared';
import { MapIcon, MoreVertical, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { boardMapName } from '@/lib/boardMap';
import { useCustomMaps, useUpdateCustomMap } from '@/lib/customMaps';
import { useCreateBoard, useDeleteBoard, useUpdateBoard } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { usePresenceStore } from '@/stores/presenceStore';
import { BoardMapPicker, type MapChoice } from './BoardMapPicker';
import { ShareDialog } from './ShareDialog';

type DialogState =
  | { kind: 'new' }
  | { kind: 'rename'; board: Board }
  | { kind: 'delete'; board: Board }
  | { kind: 'mapSize'; board: Board }
  | null;

const sameMap = (b: Board, c: MapChoice) =>
  c.kind === 'pubg' ? b.mapId === c.mapId : b.customMapId === c.id;

/** Default name "{Map} – Plan {n}" (FEATURES F4; custom maps by their own name). */
function defaultName(choice: MapChoice, mapName: string, boards: Board[]) {
  const n = boards.filter((b) => sameMap(b, choice)).length + 1;
  return `${mapName} – Plan ${n}`.slice(0, 40);
}

/**
 * UI_UX_SPEC §3.5 board tabs: select, + new, kebab (snapshots for everyone; rename / duplicate /
 * delete by role), drag to reorder.
 */
export function BoardTabs({
  roomId,
  role,
  boards,
  activeId,
  onSelect,
  onSnapshots,
}: {
  roomId: string;
  role: RoomRole;
  boards: Board[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  /** open the snapshots drawer for this board (UI_UX_SPEC §3.8) */
  onSnapshots: (board: Board) => void;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<MapChoice>({ kind: 'pubg', mapId: 'erangel' });
  const [mapName, setMapName] = useState(MAPS.erangel.name);
  const [widthM, setWidthM] = useState('');
  const customMaps = useCustomMaps(roomId);
  const updateMap = useUpdateCustomMap(roomId);
  const [dragId, setDragId] = useState<string | null>(null);
  const create = useCreateBoard(roomId);
  const update = useUpdateBoard(roomId);
  const remove = useDeleteBoard(roomId);
  const canManage = can(role, 'board.manage');
  const canDelete = can(role, 'board.delete');
  const canShare = can(role, 'board.share');
  const [shareBoard, setShareBoard] = useState<Board | null>(null);
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong');

  const close = () => {
    setDialog(null);
  };
  const current = boards.find((b) => b.id === activeId);

  return (
    <>
      {/* a tablist may only own tabs (axe aria-required-children): the actions of the active
          board and "New board" sit right after it */}
      <div data-tour="board-tabs" className="flex min-w-0 items-stretch">
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
                  active
                    ? 'bg-[linear-gradient(180deg,rgba(245,179,1,0.1),rgba(245,179,1,0.02))] shadow-[inset_0_-2px_0_var(--accent)]'
                    : 'hover:bg-surface-2/60',
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
                  title={`${b.name} (${boardMapName(b, customMaps.data)}) — ${i < 9 ? `press ${i + 1}` : ''}`}
                  onClick={() => {
                    onSelect(b.id);
                  }}
                  className={cn(
                    'flex h-12 items-center gap-2 px-3.5 text-[13px] font-medium transition-colors',
                    active ? 'text-text [&>svg]:text-accent' : 'text-text-muted hover:text-text',
                  )}
                >
                  <MapIcon className="size-3.5" aria-hidden />
                  <span className="max-w-40 truncate">{b.name}</span>
                  <BoardPresenceDots boardId={b.id} />
                </button>
              </div>
            );
          })}
        </div>
        {current && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Board actions for ${current.name}`}
              className="flex w-8 shrink-0 items-center justify-center text-text-muted hover:bg-surface hover:text-text pointer-coarse:w-11"
            >
              <MoreVertical className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  onSnapshots(current);
                }}
              >
                Snapshots…
              </DropdownMenuItem>
              {canShare && (
                <DropdownMenuItem
                  onSelect={() => {
                    setShareBoard(current);
                  }}
                >
                  Share link…
                </DropdownMenuItem>
              )}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setName(current.name);
                      setDialog({ kind: 'rename', board: current });
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      create.mutate(
                        {
                          name: `${current.name} (copy)`.slice(0, 40),
                          mapId: current.mapId,
                          ...(current.customMapId ? { customMapId: current.customMapId } : {}),
                          duplicateFrom: current.id,
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
                  {current.mapId === CUSTOM_MAP_ID && (
                    <DropdownMenuItem
                      onSelect={() => {
                        const m = customMaps.data?.find((x) => x.id === current.customMapId);
                        setName(m?.name ?? '');
                        setWidthM(m ? String(m.widthM) : '');
                        setDialog({ kind: 'mapSize', board: current });
                      }}
                    >
                      Map name &amp; size…
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    disabled={boards.length <= 1}
                    onSelect={() => {
                      setDialog({ kind: 'delete', board: current });
                    }}
                  >
                    Delete board
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canManage && (
          <button
            type="button"
            aria-label="New board"
            title="New board"
            onClick={() => {
              const first: MapChoice = { kind: 'pubg', mapId: 'erangel' };
              setChoice(first);
              setMapName(MAPS.erangel.name);
              setName(defaultName(first, MAPS.erangel.name, boards));
              setDialog({ kind: 'new' });
            }}
            className="flex h-12 shrink-0 items-center px-3 text-text-muted hover:bg-surface hover:text-text"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {shareBoard && (
        <ShareDialog
          board={shareBoard}
          open
          onOpenChange={(o) => {
            if (!o) setShareBoard(null);
          }}
        />
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        {dialog?.kind === 'new' && (
          <DialogContent title="New board">
            <form
              method="post"
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(
                  choice.kind === 'pubg'
                    ? { name, mapId: choice.mapId }
                    : { name, mapId: CUSTOM_MAP_ID, customMapId: choice.id },
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
              <BoardMapPicker
                roomId={roomId}
                customMaps={customMaps.data ?? []}
                value={choice}
                canUpload={canManage}
                onChange={(c, newMapName) => {
                  // keep the auto-generated name in sync until the user edits it
                  if (name === defaultName(choice, mapName, boards))
                    setName(defaultName(c, newMapName, boards));
                  setChoice(c);
                  setMapName(newMapName);
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
              method="post"
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
        {dialog?.kind === 'mapSize' && dialog.board.customMapId && (
          <DialogContent
            title="Map name & size"
            description="Applies to every board on this map. The grid and measure tool use the width."
          >
            <form
              method="post"
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                updateMap.mutate(
                  {
                    id: dialog.board.customMapId ?? '',
                    body: { name: name.trim(), widthM: Number(widthM) },
                  },
                  { onSuccess: close, onError: fail },
                );
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="custom-map-name">Map name</Label>
                <Input
                  id="custom-map-name"
                  value={name}
                  maxLength={CUSTOM_MAP_LIMITS.nameMax}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="custom-map-width">Width in metres (left edge to right edge)</Label>
                <Input
                  id="custom-map-width"
                  inputMode="numeric"
                  value={widthM}
                  onChange={(e) => {
                    setWidthM(e.target.value.replace(/[^\d]/g, ''));
                  }}
                />
              </div>
              <Button
                type="submit"
                disabled={
                  updateMap.isPending ||
                  name.trim().length === 0 ||
                  Number(widthM) < CUSTOM_MAP_LIMITS.widthMinM ||
                  Number(widthM) > CUSTOM_MAP_LIMITS.widthMaxM
                }
              >
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
      role="img"
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
