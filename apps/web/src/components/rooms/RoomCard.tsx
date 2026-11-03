'use client';

import { MAPS, type RoomSummary } from '@rotationlab/shared';
import { Lock, MoreVertical, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useDeleteRoom, useLeaveRoom, useUpdateRoom } from '@/lib/rooms';
import { MapThumb, RoleBadge, timeAgo } from './bits';

/** Dashboard room card (UI_UX_SPEC §3.3). Thumbnails (P1) fall back to the room initial. */
export function RoomCard({ room, priority = false }: { room: RoomSummary; priority?: boolean }) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [text, setText] = useState('');
  const leave = useLeaveRoom(room.id);
  const del = useDeleteRoom(room.id);
  const update = useUpdateRoom(room.id);
  const isOwner = room.role === 'OWNER';

  const fail = (err: unknown) => {
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong');
  };

  return (
    <article className="group relative overflow-hidden rounded-panel border bg-surface transition-colors hover:border-accent/60">
      {/* named by its content (room name first): an aria-label would hide the visible text
          from voice-control users (WCAG 2.5.3 label in name) */}
      <Link href={`/rooms/${room.id}`} className="block">
        <div className="relative aspect-[16/9]">
          <MapThumb
            mapId={room.primaryMapId}
            variant="card"
            priority={priority}
            className="size-full opacity-80"
          />
          <span className="absolute bottom-2 left-2 rounded-full bg-overlay px-2 py-0.5 text-[11px] font-medium">
            {MAPS[room.primaryMapId].name}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 p-4">
          <h3 className="flex items-center gap-1.5 truncate font-display text-lg font-bold">
            {room.name}
            {room.hasPassword && (
              <Lock className="size-3.5 text-text-muted" aria-label="Password protected" />
            )}
          </h3>
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className={
                  room.onlineCount > 0
                    ? 'size-2 rounded-full bg-success'
                    : 'size-2 rounded-full bg-border'
                }
              />
              {room.onlineCount} online
            </span>
            · <Users className="size-3" aria-hidden /> {room.memberCount} ·{' '}
            {/* server-rendered: the server's clock may sit on the other side of a minute */}
            <span suppressHydrationWarning>{timeAgo(room.lastActivityAt)}</span>
          </p>
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <RoleBadge role={room.role} /> {room.boardCount} board{room.boardCount === 1 ? '' : 's'}
          </p>
        </div>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${room.name}`}
          className="absolute top-2 right-2 rounded-control bg-overlay p-1.5 text-text-muted hover:text-text"
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isOwner && (
            <DropdownMenuItem
              onSelect={() => {
                setText(room.name);
                setDialog('rename');
              }}
            >
              Rename
            </DropdownMenuItem>
          )}
          {isOwner ? (
            <DropdownMenuItem
              destructive
              onSelect={() => {
                setText('');
                setDialog('delete');
              }}
            >
              Delete room
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              destructive
              onSelect={() => {
                leave.mutate(undefined, {
                  onSuccess: () => toast.success(`You left ${room.name}`),
                  onError: fail,
                });
              }}
            >
              Leave room
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        {dialog === 'rename' && (
          <DialogContent title="Rename room">
            <form
              method="post"
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate(
                  { name: text },
                  {
                    onSuccess: () => {
                      setDialog(null);
                    },
                    onError: fail,
                  },
                );
              }}
            >
              <Input
                aria-label="Room name"
                value={text}
                maxLength={40}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
              <Button type="submit" disabled={update.isPending}>
                Save
              </Button>
            </form>
          </DialogContent>
        )}
        {dialog === 'delete' && (
          <DialogContent
            title="Delete room"
            description={`Everyone loses access. Type "${room.name}" to confirm.`}
          >
            <form
              method="post"
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                del.mutate(text, {
                  onSuccess: () => {
                    setDialog(null);
                  },
                  onError: fail,
                });
              }}
            >
              <Input
                aria-label="Room name to confirm"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
              <Button
                type="submit"
                variant="destructive"
                disabled={text !== room.name || del.isPending}
              >
                Delete room
              </Button>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </article>
  );
}
