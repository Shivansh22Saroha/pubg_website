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
import { BoardMapView } from '@/components/map/BoardMapView';
import { ShortcutsDialog } from '@/components/tools/ShortcutsDialog';
import { Toolbar } from '@/components/tools/Toolbar';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/hooks/useMe';
import { useRoomRealtime } from '@/hooks/useRoomRealtime';
import { ApiError } from '@/lib/api';
import { loadDebugHook } from '@/lib/debug/loadDebugHook';
import { makeNameOf } from '@/lib/editing';
import { prefKeys, readPref, writePref } from '@/lib/prefs';
import { useLeaveRoom, useRoom } from '@/lib/rooms';
import { isMacPlatform, resolveShortcut } from '@/lib/shortcuts';
import { BoardTabs } from './BoardTabs';
import { InviteDialog } from './InviteDialog';
import { RoomSettingsDialog } from './RoomSettingsDialog';
import {
  PresenceStack,
  RoomGoneDialog,
  SessionExpiredDialog,
  SyncIndicator,
} from './RealtimeStatus';
import { SidePanel } from './SidePanel';

/**
 * Room workspace (UI_UX_SPEC §3.5): board tabs, toolbar, live map of the active board with the
 * drawing tools, presence, sync state, invite / settings dialogs, members & layers panel,
 * shortcut help. Chat arrives in Phase 7.
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
  const [dialog, setDialog] = useState<'invite' | 'settings' | 'help' | null>(null);
  const [gone, setGone] = useState<'kicked' | 'deleted' | null>(null);

  const boards = useMemo(() => query.data?.boards ?? [], [query.data]);
  // fall back to the first board when the remembered one is gone (deleted / other room)
  const active = boards.find((b) => b.id === picked) ?? boards[0];

  const select = (id: string) => {
    setPicked(id);
    writePref(prefKeys.lastBoard(roomId), id);
  };

  const { session, onCursor } = useRoomRealtime(roomId, me.data?.id, active?.id, {
    onKicked: () => {
      setGone('kicked');
    },
    onRoomDeleted: () => {
      setGone('deleted');
    },
    onActiveBoardDeleted: (fallback) => {
      toast('This board was deleted — moved you to the first board');
      if (fallback) setPicked(fallback.id);
    },
    onRoleChanged: (r) => {
      toast(
        `Your role changed to ${r === 'OWNER' ? 'Owner' : r === 'EDITOR' ? 'Editor' : 'Viewer'}`,
      );
    },
    onReject: (message) => {
      toast.error(message);
    },
  });

  useEffect(() => {
    const hook = session && active ? loadDebugHook() : null; // dev / E2E only
    if (!hook || !session || !active) return;
    let uninstall: (() => void) | undefined;
    let cancelled = false;
    void hook.then(({ installRlDebug }) => {
      if (!cancelled) uninstall = installRlDebug(session, active.mapId);
    });
    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [session, active]);

  const names = useMemo(
    () =>
      Object.fromEntries((query.data?.members ?? []).map((m) => [m.user.id, m.user.displayName])),
    [query.data],
  );
  const meId = me.data?.id;
  const nameOf = useMemo(() => makeNameOf(meId ?? '', names), [meId, names]);

  // UI_UX_SPEC §8: 1–9 switch board tab, ] toggles the right panel, ? help, / chat
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      const action = resolveShortcut(e, mac);
      switch (action?.kind) {
        case 'panel':
          setPanelOpen((o) => !o);
          break;
        case 'help':
          setDialog('help');
          break;
        case 'chat': {
          // Phase 7 adds the chat input; until then `/` does nothing
          const input = document.querySelector<HTMLElement>('[data-chat-input]');
          if (!input) return;
          setPanelOpen(true);
          input.focus();
          break;
        }
        case 'board': {
          const target = boards[action.index];
          if (!target) return;
          setPicked(target.id);
          writePref(prefKeys.lastBoard(roomId), target.id);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
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
          <SyncIndicator />
          <PresenceStack members={members} />
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
        <Toolbar role={role} session={session} nameOf={nameOf} />
        <main className="relative min-w-0 flex-1" aria-label="Map">
          {active && (
            <BoardMapView
              key={active.id}
              mapId={active.mapId}
              meId={me.data.id}
              names={names}
              onCursor={onCursor}
              session={session}
              role={role}
              roomName={room.name}
            />
          )}
        </main>
        {panelOpen && (
          <aside
            className="w-[340px] shrink-0 border-l bg-surface max-xl:w-[300px]"
            aria-label="Room panel"
          >
            <SidePanel
              roomId={roomId}
              role={role}
              meId={me.data.id}
              members={members}
              session={session}
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
      <ShortcutsDialog
        open={dialog === 'help'}
        onOpenChange={(o) => {
          setDialog(o ? 'help' : null);
        }}
      />
      <RoomGoneDialog reason={gone} />
      <SessionExpiredDialog />
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
