'use client';

import { MAPS, type RoomSummary } from '@rotationlab/shared';
import { Clock, Lock, MoreVertical, Users } from 'lucide-react';
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

/**
 * Dashboard room card (UI_UX_SPEC §3.3): the most recently edited board's thumbnail (Phase 11),
 * else the map's card image.
 */
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
    <article className="group surface-raised relative overflow-hidden rounded-panel transition-[border-color,box-shadow] duration-200 hover:border-accent/50 hover:shadow-[inset_0_1px_0_var(--highlight),0_18px_40px_-18px_rgba(0,0,0,0.9),0_0_0_1px_rgba(245,179,1,0.12)]">
      {/* named by its content (room name first): an aria-label would hide the visible text
          from voice-control users (WCAG 2.5.3 label in name) */}
      <Link href={`/rooms/${room.id}`} className="block">
        <div className="relative aspect-[16/9]">
          <MapThumb
            mapId={room.primaryMapId}
            variant="card"
            src={room.thumbnailUrl}
            priority={priority}
            className="size-full opacity-85 transition-[opacity,transform] duration-300 group-hover:scale-[1.03] group-hover:opacity-100"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgba(9,12,17,0.75))]"
          />
          <span className="absolute bottom-2.5 left-3 rounded-full border border-white/10 bg-black/45 px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur">
            {MAPS[room.primaryMapId].name}
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <h3 className="flex items-center gap-1.5 truncate font-display text-xl leading-tight font-bold">
            {room.name}
            {room.hasPassword && (
              <Lock className="size-3.5 text-text-muted" aria-label="Password protected" />
            )}
          </h3>
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={
                  room.onlineCount > 0
                    ? 'size-2 rounded-full bg-success shadow-[0_0_0_3px_rgba(34,197,94,0.18)]'
                    : 'size-2 rounded-full bg-border-strong'
                }
              />
              {room.onlineCount} online
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden />
              {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden />
              {/* server-rendered: the server's clock may sit on the other side of a minute */}
              <span suppressHydrationWarning>{timeAgo(room.lastActivityAt)}</span>
            </span>
          </p>
          <p className="flex items-center gap-2 text-xs text-text-muted">
            <RoleBadge role={room.role} /> {room.boardCount} board{room.boardCount === 1 ? '' : 's'}
          </p>
        </div>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${room.name}`}
          className="absolute top-2.5 right-2.5 rounded-control border border-white/10 bg-black/45 p-1.5 text-text/80 backdrop-blur hover:text-text"
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
