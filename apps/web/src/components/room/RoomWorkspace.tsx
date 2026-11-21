'use client';

import { can, CUSTOM_MAP_ID, type Board } from '@rotationlab/shared';
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  UserPlus,
  MoreHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { preload } from 'react-dom';
import { toast } from 'sonner';
import { BoardMapView } from '@/components/map/BoardMapView';
import { SnapshotsDrawer } from '@/components/snapshots/SnapshotsDrawer';
import { ShortcutsDialog } from '@/components/tools/ShortcutsDialog';
import { Toolbar, UndoRedo } from '@/components/tools/Toolbar';
import StarBorder from '@/components/fx/StarBorder/StarBorder';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isTouchLayout, useBreakpoint, useLandscapePhone } from '@/hooks/useBreakpoint';
import { useMe } from '@/hooks/useMe';
import { useRoomRealtime } from '@/hooks/useRoomRealtime';
import { useVoice } from '@/hooks/useVoice';
import { useThumbnailUploader } from '@/hooks/useThumbnailUploader';
import { ApiError } from '@/lib/api';
import { boardMapInfo } from '@/lib/boardMap';
import { useCustomMaps } from '@/lib/customMaps';
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
import { RoomTour } from './RoomTour';
import { LeftPanel } from './LeftPanel';
import { SidePanel, UnreadBadge } from './SidePanel';
import { VoiceControls } from './VoiceControls';
import {
  BoardSelect,
  ChatButton,
  FullSheet,
  HalfSheet,
  PhoneRoomMenu,
  type PhoneMenuItem,
} from './TouchChrome';
import { useChatStore } from '@/stores/chatStore';
import { useFxStore } from '@/stores/fxStore';
import { useSpotter } from '@/stores/spotterStore';
import { SpotterIcon } from '@/components/spotter/SpotterIcon';
import { useFollowStore } from '@/stores/followStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { setPlayers } from '@/stores/playersStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Room workspace (UI_UX_SPEC §3.5): board tabs, toolbar, live map of the active board with the
 * drawing tools, presence, sync state, invite / settings dialogs, members & layers panel,
 * shortcut help, chat with map pings, follow & summon.
 */
/** how the floating chrome slides away for Full map */
const CHROME_MOTION =
  'transition-[opacity,transform,visibility] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]';

export function RoomWorkspace({ roomId }: { roomId: string }) {
  const router = useRouter();
  const me = useMe();
  const query = useRoom(roomId);
  const leave = useLeaveRoom(roomId);
  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readPref(prefKeys.lastBoard(roomId)),
  );
  const panelOpen = useWorkspaceStore((s) => s.panelOpen);
  const setPanelOpen = useWorkspaceStore((s) => s.setPanelOpen);
  const leftOpen = useWorkspaceStore((s) => s.leftOpen);
  const setLeftOpen = useWorkspaceStore((s) => s.setLeftOpen);
  const fullMap = useWorkspaceStore((s) => s.fullMap);
  const setFullMap = useWorkspaceStore((s) => s.setFullMap);
  const unread = useChatStore((s) => s.unread);
  const [dialog, setDialog] = useState<'invite' | 'settings' | 'help' | null>(null);
  const [gone, setGone] = useState<'kicked' | 'deleted' | null>(null);
  const [snapshotsFor, setSnapshotsFor] = useState<Board | null>(null);
  const breakpoint = useBreakpoint();
  const touch = isTouchLayout(breakpoint);
  const phone = breakpoint === 'phone';
  // a phone held sideways: tools in a left column so the map keeps its height
  const landscape = useLandscapePhone() && phone;

  // Glass layout (2026-11-21, from the approved room demo): on desktop / compact the map fills
  // the screen; the room card, board pill and actions float along the top, route options +
  // layers on the left, chat · members · replay on the right, the tools in a bottom dock. The
  // map's own overlays (HUD, minimap, grid letters, style bar, follow pill, compass) keep clear
  // of that chrome through these insets — CSS variables + the store.
  const panelWidth = breakpoint === 'desktop' ? 340 : 300;
  const leftWidth = breakpoint === 'desktop' ? 300 : 280;
  const chromeTop = touch || fullMap ? 0 : 72;
  const chromeLeft = !touch && leftOpen && !fullMap ? leftWidth + 24 : 0;
  const chromeRight = !touch && panelOpen && !fullMap ? panelWidth + 24 : 0;
  // the dock: 56 px + its 12 px gap + 12 px breathing room
  const chromeBottom = touch ? 0 : 80;
  useLayoutEffect(() => {
    useWorkspaceStore
      .getState()
      .setChrome({ top: chromeTop, left: chromeLeft, right: chromeRight, bottom: chromeBottom });
  }, [chromeTop, chromeLeft, chromeRight, chromeBottom]);
  // leaving the room screen brings the panels back next time
  useEffect(
    () => () => {
      useWorkspaceStore.getState().setFullMap(false);
    },
    [],
  );
  const chromeVars = {
    '--chrome-top': `${chromeTop}px`,
    '--chrome-left': `${chromeLeft}px`,
    '--chrome-right': `${chromeRight}px`,
    '--chrome-bottom': `${chromeBottom}px`,
  } as CSSProperties;

  // UI_UX_SPEC §7: the panel starts open only on wide screens (compact: collapsed; tablet /
  // phone: it is a sheet) — and closes when the layout changes under it
  useEffect(() => {
    setPanelOpen(breakpoint === 'desktop');
    setLeftOpen(breakpoint === 'desktop');
  }, [breakpoint, setPanelOpen, setLeftOpen]);

  const boards = useMemo(() => query.data?.boards ?? [], [query.data]);
  // fall back to the first board when the remembered one is gone (deleted / other room)
  const active = boards.find((b) => b.id === picked) ?? boards[0];
  // custom maps (F20): only fetched when a board uses one
  const hasCustom = boards.some((b) => b.mapId === CUSTOM_MAP_ID);
  const customMaps = useCustomMaps(roomId, hasCustom);
  const activeMap = active ? boardMapInfo(active, customMaps.data) : null;
  // a teammate just uploaded the map this board uses: our list predates it — fetch it once
  const missingMapId =
    active?.customMapId && customMaps.data && !activeMap ? active.customMapId : null;
  const refetchedFor = useRef<string | null>(null);
  const { refetch: refetchCustomMaps, isFetching: fetchingCustomMaps } = customMaps;
  useEffect(() => {
    if (!missingMapId || fetchingCustomMaps || refetchedFor.current === missingMapId) return;
    refetchedFor.current = missingMapId;
    void refetchCustomMaps();
  }, [missingMapId, fetchingCustomMaps, refetchCustomMaps]);
  // UI_UX_SPEC §9: the 819 px low-res art (a custom map's preview) shows first — start fetching
  // it with the room data, before the map bundle has even loaded (MapCanvas's overlay uses the
  // same URL and CORS mode)
  if (activeMap) {
    preload(activeMap.backgroundUrl, {
      as: 'image',
      crossOrigin: 'anonymous',
      fetchPriority: 'high',
    });
  }

  const select = (id: string) => {
    setPicked(id);
    writePref(prefKeys.lastBoard(roomId), id);
  };

  // Phase 11: 30 s after my last edit, refresh the board's dashboard thumbnail
  useThumbnailUploader(
    active?.id,
    activeMap,
    query.data ? can(query.data.room.role, 'board.edit') : false,
  );

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
    onBoardReset: (reason, actorId) => {
      if (reason === 'snapshot_restore') {
        useFxStore.getState().playRewind();
        toast(`Board was restored by ${nameOfRef.current(actorId)}`, { id: 'board-reset' });
      }
    },
    onSummon: (userId, boardId) => {
      const follow = useFollowStore.getState();
      if (follow.leaderId === userId) return;
      // FEATURES F8: follow at once; "Don't follow" (5 s) opts out
      follow.dispatch({ type: 'start', leaderId: userId, summoned: true });
      useWorkspaceStore.getState().requestBoard(boardId);
      toast(`${nameOfRef.current(userId)} is presenting — following`, {
        id: `summon-${userId}`,
        duration: 5_000,
        action: {
          label: 'Don’t follow',
          onClick: () => {
            useFollowStore.getState().dispatch({ type: 'stop' });
          },
        },
      });
    },
  });

  const voice = useVoice(roomId, me.data?.id);
  const voiceStatus = useVoiceStore((s) => s.status);
  const inVoice = useVoiceStore((s) => s.peers.length);

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
  // linked own-player markers (Phase 12) read members' IGNs from here
  useEffect(() => {
    setPlayers(query.data?.members ?? []);
  }, [query.data]);
  const meId = me.data?.id;
  const nameOf = useMemo(() => makeNameOf(meId ?? '', names), [meId, names]);
  const nameOfRef = useRef(nameOf);
  useEffect(() => {
    nameOfRef.current = nameOf;
  });

  // follow mode: the reducer's effects go out through this session
  useEffect(() => {
    if (!session || !meId) return;
    useFollowStore.getState().bind({
      meId,
      nameOf: (id) => nameOfRef.current(id),
      run: (e) => {
        if (e.kind === 'emitStart') session.followStart(e.leaderId);
        else if (e.kind === 'emitStop') session.followStop(e.leaderId);
        else toast(e.message, { id: 'follow' });
      },
    });
    const offPresence = usePresenceStore.subscribe((s, prev) => {
      if (s.users !== prev.users)
        useFollowStore
          .getState()
          .dispatch({ type: 'presence', online: new Set(Object.keys(s.users)) });
    });
    return () => {
      offPresence();
      useFollowStore.getState().dispatch({ type: 'stop' });
      useFollowStore.getState().bind(null);
    };
  }, [session, meId]);

  // ping chips and follow mode ask for another board
  useEffect(
    () =>
      useWorkspaceStore.subscribe((s, prev) => {
        const req = s.boardRequest;
        if (!req || req === prev.boardRequest) return;
        if (boards.some((b) => b.id === req.boardId)) {
          setPicked(req.boardId);
          writePref(prefKeys.lastBoard(roomId), req.boardId);
        }
      }),
    [boards, roomId],
  );

  const summon = () => {
    void session?.summon().then((res) => {
      if (res?.ok) toast('Everyone in the room was asked to follow you', { id: 'summon' });
      else toast.error(res?.message ?? 'Could not summon — are you online?');
    });
  };

  // UI_UX_SPEC §8: 1–9 switch board tab, ] toggles the right panel, ? help, / chat
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      const action = resolveShortcut(e, mac);
      switch (action?.kind) {
        case 'panel':
          // from Full map, ] brings the panels back; otherwise it toggles the side panel
          if (useWorkspaceStore.getState().fullMap) {
            setFullMap(false);
            setPanelOpen(true);
          } else setPanelOpen((o) => !o);
          break;
        case 'leftPanel':
          if (useWorkspaceStore.getState().fullMap) {
            setFullMap(false);
            setLeftOpen(true);
          } else setLeftOpen((o) => !o);
          break;
        case 'fullMap':
          setFullMap((f) => !f);
          break;
        case 'help':
          setDialog('help');
          break;
        case 'chat':
          useWorkspaceStore.getState().focusChat();
          break;
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
  }, [boards, roomId, setPanelOpen, setLeftOpen, setFullMap]);

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
  const leaveRoom = () => {
    leave.mutate(undefined, {
      onSuccess: () => {
        toast.success(`You left ${room.name}`);
        router.replace('/dashboard');
      },
    });
  };
  const openPanel = (tab?: 'chat' | 'members') => {
    if (tab) useWorkspaceStore.getState().setTab(tab);
    setPanelOpen(true);
  };
  const sidePanel = (
    <SidePanel
      roomId={roomId}
      role={role}
      meId={me.data.id}
      members={members}
      boards={boards}
      session={session}
      split={!touch}
    />
  );
  const toolbar = (
    <Toolbar
      role={role}
      session={session}
      nameOf={nameOf}
      breakpoint={breakpoint}
      orientation={touch && landscape ? 'vertical' : 'horizontal'}
      compact={phone}
      floating={!touch}
    />
  );
  const phoneMenu: PhoneMenuItem[] = [
    ...(can(role, 'invite.create')
      ? [
          {
            label: 'Invite teammates',
            onSelect: () => {
              setDialog('invite');
            },
          },
        ]
      : []),
    voiceStatus === 'idle'
      ? {
          label: inVoice > 0 ? `Join voice (${inVoice} in)` : 'Join voice',
          onSelect: () => void voice?.join(),
        }
      : { label: 'Leave voice', onSelect: () => void voice?.leave() },
    {
      label: 'Members',
      onSelect: () => {
        openPanel('members');
      },
    },
    {
      label: 'Chat',
      onSelect: () => {
        openPanel('chat');
      },
    },
    ...(active
      ? [
          {
            label: 'Snapshots…',
            onSelect: () => {
              setSnapshotsFor(active);
            },
          },
          {
            label: 'Export view as PNG',
            onSelect: () => {
              useWorkspaceStore.getState().requestExport('view');
            },
          },
          {
            label: 'Export whole map as PNG',
            onSelect: () => {
              useWorkspaceStore.getState().requestExport('map');
            },
          },
        ]
      : []),
    {
      label: fullMap ? 'Show the top bar' : 'Full map view',
      onSelect: () => {
        setFullMap((f) => !f);
      },
    },
    {
      label: 'Ask Spotter',
      onSelect: () => {
        useSpotter.getState().setOpen(true);
      },
    },
    ...(can(role, 'room.manage')
      ? [
          {
            label: 'Room settings',
            onSelect: () => {
              setDialog('settings');
            },
          },
        ]
      : []),
    ...(role !== 'OWNER'
      ? [{ label: 'Leave room', onSelect: leaveRoom, destructive: true, separatorBefore: true }]
      : []),
  ];

  return (
    <div
      className={cn('relative h-dvh', touch ? 'flex flex-col' : 'overflow-hidden')}
      data-layout={breakpoint}
      data-fullmap={fullMap ? 'on' : 'off'}
      style={chromeVars}
    >
      {phone ? (
        <header
          className={cn(
            'relative z-30 flex shrink-0 items-center gap-1 border-b border-[var(--edge)] bg-[var(--glass)] pr-1 backdrop-blur-xl backdrop-saturate-150',
            fullMap && 'hidden',
            landscape
              ? 'h-11 pr-[max(0.25rem,env(safe-area-inset-right))] pl-[env(safe-area-inset-left)]'
              : 'h-12',
          )}
        >
          <Link
            href="/dashboard"
            aria-label="Back to dashboard"
            className="flex size-11 shrink-0 items-center justify-center text-text-muted hover:text-text"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="sr-only" data-testid="room-name">
            {room.name}
          </span>
          <BoardSelect boards={boards} activeId={active?.id} onSelect={select} />
          <UndoRedo role={role} session={session} nameOf={nameOf} size="sm" />
          <SyncIndicator />
          <PhoneRoomMenu items={phoneMenu} />
        </header>
      ) : (
        // one row so the three groups never overlap: the board pill takes what's left and
        // scrolls when the window is tight
        <header
          className={cn(
            'pointer-events-none absolute inset-x-3 top-3 z-30 flex items-start gap-3 [&>*]:pointer-events-auto',
            CHROME_MOTION,
            fullMap && 'invisible -translate-y-4 opacity-0',
          )}
        >
          {/* top left: the room card — live dot · room name (menu), the board below */}
          <div className="glass-panel flex h-[60px] max-w-[min(340px,26vw)] shrink-0 items-stretch overflow-hidden rounded-[16px]">
            <Link
              href="/dashboard"
              aria-label="Back to dashboard"
              className="flex w-10 shrink-0 items-center justify-center border-r border-[var(--edge)] text-text-muted hover:bg-white/[0.05] hover:text-text"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div className="flex min-w-0 flex-col justify-center py-1.5 pr-3 pl-3">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex min-w-0 items-center gap-1.5 self-start rounded-[6px] text-xs text-text-muted hover:text-text">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                  <span className="truncate" data-testid="room-name">
                    {room.name}
                  </span>
                  <ChevronDown className="size-3 shrink-0" aria-hidden />
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
                      <DropdownMenuItem destructive onSelect={leaveRoom}>
                        Leave room
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <span
                className="truncate font-display text-[19px] leading-tight font-bold"
                data-testid="board-title"
              >
                {active?.name ?? 'No board yet'}
              </span>
            </div>
          </div>

          {/* top centre: the board switcher pill (the demo's "Zone 1–5"); below the card row
              when the window is too narrow for both */}
          <div className="!pointer-events-none flex min-w-0 flex-1 justify-center pt-1.5">
            <div className="glass-panel pointer-events-auto flex h-12 max-w-full min-w-0 items-stretch overflow-hidden rounded-full px-1.5">
              <BoardTabs
                roomId={roomId}
                role={role}
                boards={boards}
                activeId={active?.id}
                onSelect={select}
                onSnapshots={(b) => {
                  setSnapshotsFor(b);
                }}
              />
            </div>
          </div>

          {/* top right: voice, who's here, actions */}
          <div className="glass-panel flex h-[60px] shrink-0 items-center gap-1.5 rounded-[16px] px-2.5">
            <SyncIndicator />
            <VoiceControls voice={voice} members={members} variant="header" />
            <PresenceStack
              members={members}
              meId={me.data.id}
              canSummon={can(role, 'board.edit')}
              boards={boards}
              onGoToBoard={select}
              onSummon={summon}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 px-3"
              data-testid="fullmap-toggle"
              aria-label="Full map view"
              title="Full map view (H)"
              onClick={() => {
                setFullMap(true);
              }}
            >
              <Maximize2 className="size-4" aria-hidden />
              <span aria-hidden className="max-[1439px]:hidden">
                Full map
              </span>
            </Button>
            {can(role, 'invite.create') && (
              <StarBorder
                as="button"
                type="button"
                data-tour="invite"
                color="#f5b942"
                duration={5}
                radius={11}
                thickness={1}
                className="flex h-9 items-center gap-1.5 px-3 text-sm font-semibold"
                onClick={() => {
                  setDialog('invite');
                }}
              >
                <UserPlus className="size-4" aria-hidden /> Invite
              </StarBorder>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More"
                data-testid="more-menu"
                className="flex size-9 items-center justify-center rounded-[10px] text-text-muted hover:bg-white/[0.06] hover:text-text"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!active}
                  onSelect={() => {
                    useWorkspaceStore.getState().requestExport('view');
                  }}
                >
                  Export view as PNG
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!active}
                  onSelect={() => {
                    useWorkspaceStore.getState().requestExport('map');
                  }}
                >
                  Export whole map as PNG
                </DropdownMenuItem>
                {active && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setSnapshotsFor(active);
                    }}
                  >
                    Snapshots…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label="Ask Spotter"
              title="Ask Spotter — site help & BGMI tactics"
              data-testid="spotter-room-button"
              onClick={() => {
                const s = useSpotter.getState();
                s.setOpen(!s.open);
              }}
            >
              <SpotterIcon className="size-[18px]" />
            </Button>
            {can(role, 'room.manage') && (
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
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
              className="relative size-9"
              data-testid="panel-toggle"
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
              {!panelOpen && unread > 0 && (
                <span className="absolute -top-1 -right-1">
                  <UnreadBadge count={unread} />
                </span>
              )}
            </Button>
          </div>
        </header>
      )}

      {!touch && fullMap && (
        <div className="animate-drop-in absolute top-3 right-3 z-30 flex items-center gap-2">
          <span className="glass-panel flex h-10 max-w-72 items-center truncate rounded-xl px-3 text-sm font-semibold">
            {room.name}
            {active && (
              <span className="ml-1.5 truncate font-normal text-text-muted">· {active.name}</span>
            )}
          </span>
          <button
            type="button"
            data-testid="fullmap-exit"
            className="glass-panel flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:text-accent"
            title="Show panels (H)"
            onClick={() => {
              setFullMap(false);
            }}
          >
            <Minimize2 className="size-4" aria-hidden /> Show panels
          </button>
        </div>
      )}
      {touch && fullMap && (
        <button
          type="button"
          data-testid="fullmap-exit"
          className="glass-panel animate-drop-in absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 z-[1100] flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold"
          onClick={() => {
            setFullMap(false);
          }}
        >
          <Minimize2 className="size-4" aria-hidden /> Show top bar
        </button>
      )}
      <div className={touch ? 'flex min-h-0 flex-1' : 'contents'}>
        {!touch ? (
          // bottom centre: the tool dock (stays in Full map)
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center [&>nav]:pointer-events-auto">
            {toolbar}
          </div>
        ) : (
          landscape && toolbar
        )}
        <main className={touch ? 'relative min-w-0 flex-1' : 'absolute inset-0'} aria-label="Map">
          {phone && (
            <div className="absolute top-2 left-2 z-[1100]">
              <VoiceControls voice={voice} members={members} variant="dock" />
            </div>
          )}
          {active && !activeMap && (
            <p
              role="status"
              className="flex h-full items-center justify-center gap-2 text-text-muted"
            >
              {customMaps.isError ? (
                'Couldn’t load this board’s map — check your connection'
              ) : customMaps.isPending || customMaps.isFetching ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading map…
                </>
              ) : (
                'This board’s map was removed'
              )}
            </p>
          )}
          {active && activeMap && (
            <BoardMapView
              key={active.id}
              boardId={active.id}
              map={activeMap}
              meId={me.data.id}
              names={names}
              onCursor={onCursor}
              session={session}
              role={role}
              roomName={room.name}
              boardName={active.name}
            />
          )}
        </main>
        {!touch && !fullMap && leftOpen && (
          <aside
            className="glass-panel animate-slide-in-left absolute top-[84px] bottom-[80px] left-3 z-30 overflow-hidden"
            style={{ width: leftWidth }}
            aria-label="Plan panel"
          >
            <LeftPanel
              role={role}
              session={session}
              members={members}
              meId={me.data.id}
              boards={boards}
              onCollapse={() => {
                setLeftOpen(false);
              }}
            />
          </aside>
        )}
        {!touch && !fullMap && !leftOpen && (
          <button
            type="button"
            data-testid="left-panel-open"
            aria-label="Show left panel"
            title="Routes & layers ([)"
            className="glass-panel animate-slide-in-left absolute top-[84px] left-3 z-30 flex h-10 items-center gap-2 rounded-[12px] px-3 text-sm font-semibold text-text-muted hover:text-text"
            onClick={() => {
              setLeftOpen(true);
            }}
          >
            <PanelLeftOpen className="size-4" aria-hidden /> Plan
          </button>
        )}
        {panelOpen && !touch && !fullMap && (
          <aside
            className="glass-panel animate-slide-in-right absolute top-[84px] right-3 bottom-[80px] z-30 overflow-hidden"
            style={{ width: panelWidth }}
            aria-label="Room panel"
          >
            {sidePanel}
          </aside>
        )}
      </div>
      {touch && !landscape && toolbar}
      {touch && !panelOpen && (
        <ChatButton
          unread={unread}
          onClick={() => {
            openPanel('chat');
          }}
        />
      )}
      {touch && !phone && panelOpen && (
        <HalfSheet
          onClose={() => {
            setPanelOpen(false);
          }}
        >
          {sidePanel}
        </HalfSheet>
      )}
      {phone && (
        <FullSheet
          open={panelOpen}
          onClose={() => {
            setPanelOpen(false);
          }}
        >
          {sidePanel}
        </FullSheet>
      )}
      <RoomTour enabled={Boolean(active)} />

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
      {snapshotsFor && (
        <SnapshotsDrawer
          // the latest copy of that board (renames)
          board={boards.find((b) => b.id === snapshotsFor.id) ?? snapshotsFor}
          role={role}
          meId={me.data.id}
          onClose={() => {
            setSnapshotsFor(null);
          }}
        />
      )}
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
