'use client';

import { can } from '@rotationlab/shared';
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/auth/UserMenu';
import { MapView } from '@/components/map/MapView';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/hooks/useMe';
import { ApiError } from '@/lib/api';
import { prefKeys, readPref, writePref } from '@/lib/prefs';
import { useLeaveRoom, useRoom } from '@/lib/rooms';
import { BoardTabs } from './BoardTabs';
import { InviteDialog } from './InviteDialog';
import { RoomSettingsDialog } from './RoomSettingsDialog';
import { SidePanel } from './SidePanel';

function isTypingTarget(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
  );
}

/**
 * Room workspace shell (UI_UX_SPEC §3.5) — Phase 4: board tabs, map of the active board,
 * invite / settings dialogs, members & layers panel. Drawing tools, presence, chat and sync
 * arrive with the realtime phases.
 */
export function RoomWorkspace({ roomId }: { roomId: string }) {
  const router = useRouter();
  const me = useMe();
  const query = useRoom(roomId);
  const leave = useLeaveRoom(roomId);
  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readPref(prefKeys.lastBoard(roomId)),
  );
  const [panelOpen, setPanelOpen] = useState(true);
  const [dialog, setDialog] = useState<'invite' | 'settings' | null>(null);

  const boards = useMemo(() => query.data?.boards ?? [], [query.data]);
  // fall back to the first board when the remembered one is gone (deleted / other room)
  const active = boards.find((b) => b.id === picked) ?? boards[0];

  const select = (id: string) => {
    setPicked(id);
    writePref(prefKeys.lastBoard(roomId), id);
  };

  // UI_UX_SPEC §8: 1–9 switch board tab, ] toggles the right panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === ']') {
        setPanelOpen((o) => !o);
        return;
      }
      const n = Number(e.key);
      const target = Number.isInteger(n) && n >= 1 && n <= 9 ? boards[n - 1] : undefined;
      if (target) {
        setPicked(target.id);
        writePref(prefKeys.lastBoard(roomId), target.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [boards, roomId]);

  if (query.isPending || !me.data) {
    return (
      <p role="status" className="flex h-dvh items-center justify-center gap-2 text-text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading room…
      </p>
    );
  }
  if (query.error) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-display text-2xl font-bold">
          {gone ? 'Room not found' : 'Could not load room'}
        </h1>
        <p className="text-text-muted">
          {gone ? "It may have been deleted, or you're no longer a member." : 'Please try again.'}
        </p>
        <Link href="/dashboard" className={buttonVariants()}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { room, members } = query.data;
  const role = room.role;
  const meId = me.data.id;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-stretch border-b bg-bg">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="flex w-12 shrink-0 items-center justify-center border-r text-text-muted hover:text-text"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex max-w-56 shrink-0 items-center gap-1 border-r px-3 font-display text-base font-bold hover:bg-surface">
            <span className="truncate" data-testid="room-name">
              {room.name}
            </span>
            <ChevronDown className="size-4 shrink-0 text-text-muted" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {can(role, 'room.manage') && (
              <DropdownMenuItem
                onSelect={() => {
                  setDialog('settings');
                }}
              >
                Room settings
              </DropdownMenuItem>
            )}
            {can(role, 'invite.create') && (
              <DropdownMenuItem
                onSelect={() => {
                  setDialog('invite');
                }}
              >
                Invite teammates
              </DropdownMenuItem>
            )}
            {role !== 'OWNER' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    leave.mutate(undefined, {
                      onSuccess: () => {
                        toast.success(`You left ${room.name}`);
                        router.replace('/dashboard');
                      },
                    });
                  }}
                >
                  Leave room
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <BoardTabs
          roomId={roomId}
          role={role}
          boards={boards}
          activeId={active?.id}
          onSelect={select}
        />

        <div className="ml-auto flex shrink-0 items-center gap-2 px-3">
          <div
            className="hidden items-center -space-x-2 md:flex"
            aria-label={`${members.length} members`}
          >
            {members.slice(0, 5).map((m) => (
              <span
                key={m.user.id}
                title={m.user.displayName}
                className="rounded-full ring-2 ring-bg"
              >
                <Avatar user={m.user} className="size-7 text-xs" />
              </span>
            ))}
            {members.length > 5 && (
              <span className="pl-3 text-xs text-text-muted">+{members.length - 5}</span>
            )}
          </div>
          {can(role, 'invite.create') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDialog('invite');
              }}
            >
              <UserPlus className="size-4" aria-hidden /> Invite
            </Button>
          )}
          {can(role, 'room.manage') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Room settings"
              onClick={() => {
                setDialog('settings');
              }}
            >
              <Settings className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={panelOpen ? 'Hide side panel' : 'Show side panel'}
            aria-pressed={panelOpen}
            title="Toggle panel (])"
            onClick={() => {
              setPanelOpen((o) => !o);
            }}
          >
            {panelOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1" aria-label="Map">
          {active && <MapView key={active.id} mapId={active.mapId} />}
        </main>
        {panelOpen && (
          <aside
            className="w-[340px] shrink-0 border-l bg-surface max-xl:w-[300px]"
            aria-label="Room panel"
          >
            <SidePanel
              roomId={roomId}
              role={role}
              meId={meId}
              members={members}
              boardId={active?.id}
            />
          </aside>
        )}
      </div>

      {can(role, 'invite.create') && (
        <InviteDialog
          roomId={roomId}
          role={role}
          defaultRole={room.defaultRole}
          open={dialog === 'invite'}
          onOpenChange={(o) => {
            setDialog(o ? 'invite' : null);
          }}
        />
      )}
      {dialog === 'settings' && (
        <RoomSettingsDialog
          room={room}
          members={members}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </div>
  );
}
