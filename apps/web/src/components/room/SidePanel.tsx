'use client';

import {
  can,
  type AssignableRole,
  type Board,
  type Member,
  type RoomRole,
} from '@rotationlab/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/auth/UserMenu';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { RoleBadge } from '@/components/rooms/bits';
import { ElementList } from '@/components/tools/ElementList';
import { LayersPanel } from '@/components/tools/LayersPanel';
import { PlanPanel, Replay, Routes } from './PlanPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { useKickMember, useSetMemberRole } from '@/lib/rooms';
import { useChatStore } from '@/stores/chatStore';
import { usePresenceStore } from '@/stores/presenceStore';
import ElectricBorder from '@/components/fx/ElectricBorder/ElectricBorder';
import { useVoiceStore } from '@/stores/voiceStore';
import { useWorkspaceStore, type PanelTab } from '@/stores/workspaceStore';

/**
 * Layers (and the same board as a table, UI_UX_SPEC §10): the desktop left panel, or the Layers
 * tab in touch sheets.
 */
export function LayersSection({
  role,
  session,
  members,
  meId,
  boards,
}: {
  role: RoomRole;
  session: RoomSession | null;
  members: Member[];
  meId: string;
  boards: Board[];
}) {
  const [layersView, setLayersView] = useState<'layers' | 'list'>('layers');
  return (
    <>
      <div role="group" aria-label="Layers view" className="mb-2 flex gap-1">
        {(['layers', 'list'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={layersView === v}
            data-testid={`layers-view-${v}`}
            onClick={() => {
              setLayersView(v);
            }}
            className={cn(
              'h-7 rounded-control px-2 text-xs text-text-muted hover:bg-white/[0.06] hover:text-text pointer-coarse:h-11',
              layersView === v && 'bg-white/10 text-text',
            )}
          >
            {v === 'layers' ? 'Layers' : 'List'}
          </button>
        ))}
      </div>
      {layersView === 'layers' ? (
        <LayersPanel role={role} session={session} />
      ) : (
        <ElementList role={role} session={session} members={members} meId={meId} boards={boards} />
      )}
    </>
  );
}

/**
 * Room panel (UI_UX_SPEC §3.5). Desktop (`split`, glass layout 2026-11-21): the right panel —
 * Chat · Members · Replay, with route options + layers in the left panel. Touch sheets: Chat ·
 * Layers · Members · Plan.
 */
export function SidePanel({
  roomId,
  role,
  meId,
  members,
  boards,
  session,
  split = false,
}: {
  roomId: string;
  role: RoomRole;
  meId: string;
  members: Member[];
  boards: Board[];
  session: RoomSession | null;
  split?: boolean;
}) {
  const stored = useWorkspaceStore((s) => s.tab);
  const setTab = useWorkspaceStore((s) => s.setTab);
  const unread = useChatStore((s) => s.unread);
  // a tab that lives elsewhere in this layout shows chat instead
  const here: readonly PanelTab[] = split
    ? ['chat', 'members', 'replay']
    : ['chat', 'layers', 'members', 'plan'];
  const tab: PanelTab = here.includes(stored) ? stored : stored === 'replay' ? 'plan' : 'chat';
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as PanelTab);
      }}
      className="flex h-full flex-col"
    >
      <TabsList>
        <TabsTrigger value="chat">
          Chat
          {unread > 0 && tab !== 'chat' && <UnreadBadge count={unread} />}
        </TabsTrigger>
        {!split && <TabsTrigger value="layers">Layers</TabsTrigger>}
        <TabsTrigger value="members">Members</TabsTrigger>
        {split ? (
          <TabsTrigger value="replay" data-testid="tab-replay">
            Replay
          </TabsTrigger>
        ) : (
          <TabsTrigger value="plan" data-testid="tab-plan">
            Plan
          </TabsTrigger>
        )}
      </TabsList>
      {/* forceMount keeps the chat (scroll position, draft) alive while another tab shows */}
      <TabsContent value="chat" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <ChatPanel
          roomId={roomId}
          meId={meId}
          role={role}
          members={members}
          boards={boards}
          session={session}
        />
      </TabsContent>
      {!split && (
        <TabsContent value="layers" className="overflow-y-auto p-2">
          <LayersSection
            role={role}
            session={session}
            members={members}
            meId={meId}
            boards={boards}
          />
        </TabsContent>
      )}
      <TabsContent value="members" className="overflow-y-auto p-2">
        <MembersList roomId={roomId} role={role} meId={meId} members={members} />
      </TabsContent>
      {/* forceMount: a replay keeps playing while another tab shows */}
      {split ? (
        <TabsContent
          value="replay"
          forceMount
          className="min-h-0 flex-1 overflow-y-auto p-3 data-[state=inactive]:hidden"
        >
          <Replay members={members} meId={meId} />
        </TabsContent>
      ) : (
        <TabsContent
          value="plan"
          forceMount
          className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
        >
          <PlanPanel members={members} meId={meId} />
        </TabsContent>
      )}
    </Tabs>
  );
}

/**
 * The phone sheet's sections (exact room demo): Routes (route options + layers) · Chat · Squad ·
 * Replay. Chat and Replay stay mounted so a draft or a playing replay survive switching.
 */
export function PhonePanels({
  tab,
  roomId,
  role,
  meId,
  members,
  boards,
  session,
}: {
  tab: PanelTab;
  roomId: string;
  role: RoomRole;
  meId: string;
  members: Member[];
  boards: Board[];
  session: RoomSession | null;
}) {
  return (
    <div className="h-full pt-2">
      {tab === 'plan' && (
        <div className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain pb-2">
          <Routes members={members} meId={meId} />
          <LayersSection
            role={role}
            session={session}
            members={members}
            meId={meId}
            boards={boards}
          />
        </div>
      )}
      <div className={cn('h-full', tab !== 'chat' && 'hidden')}>
        <ChatPanel
          roomId={roomId}
          meId={meId}
          role={role}
          members={members}
          boards={boards}
          session={session}
        />
      </div>
      {tab === 'members' && (
        <div className="h-full overflow-y-auto overscroll-contain pb-2">
          <MembersList roomId={roomId} role={role} meId={meId} members={members} />
        </div>
      )}
      <div
        className={cn(
          'h-full overflow-y-auto overscroll-contain pb-2',
          tab !== 'replay' && 'hidden',
        )}
      >
        <Replay members={members} meId={meId} />
      </div>
    </div>
  );
}

function MembersList({
  roomId,
  role,
  meId,
  members,
}: {
  roomId: string;
  role: RoomRole;
  meId: string;
  members: Member[];
}) {
  const setRole = useSetMemberRole(roomId);
  const kick = useKickMember(roomId);
  const [kickTarget, setKickTarget] = useState<Member | null>(null);
  const [ban, setBan] = useState(false);
  const manage = can(role, 'room.manage');
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong');
  // online first (presence arrives in Phase 5), then by join order
  // online first (live presence), then join order
  const online = usePresenceStore((st) => st.users);
  const speaking = useVoiceStore((st) => st.speaking);
  const sorted = [...members].sort(
    (a, b) => Number(b.user.id in online) - Number(a.user.id in online),
  );

  return (
    <>
      <ul className="flex flex-col gap-2" aria-label="Members">
        {sorted.map((m) => {
          const talking = Boolean(speaking[m.user.id]);
          const row = (
            <div
              className={cn(
                'flex items-center gap-2.5 rounded-[12px] border border-[var(--edge)] bg-white/[0.03] px-2.5 py-2 transition-colors hover:bg-white/[0.06]',
                talking && 'border-transparent bg-[rgba(94,234,212,0.06)]',
              )}
            >
              <span className="relative">
                <Avatar user={m.user} className="size-7 text-xs" />
                <span
                  role="img"
                  aria-label={m.user.id in online ? 'online' : 'offline'}
                  data-testid="member-online"
                  data-online={m.user.id in online}
                  className={cn(
                    'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface',
                    m.user.id in online ? 'bg-success' : 'bg-border',
                  )}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.user.displayName}
                  {m.user.id === meId && <span className="text-text-muted"> (you)</span>}
                </p>
                <p className="truncate text-xs text-text-muted">@{m.user.username}</p>
              </div>
              {talking && (
                <span className="rl-eq shrink-0" role="img" aria-label="talking">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {manage && m.role !== 'OWNER' ? (
                <>
                  <NativeSelect
                    aria-label={`Role of ${m.user.displayName}`}
                    className="h-8 w-24 px-2 text-xs"
                    value={m.role}
                    disabled={setRole.isPending}
                    onChange={(e) => {
                      setRole.mutate(
                        { userId: m.user.id, role: e.target.value as AssignableRole },
                        { onError: fail },
                      );
                    }}
                  >
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => {
                      setBan(false);
                      setKickTarget(m);
                    }}
                  >
                    Kick
                  </Button>
                </>
              ) : (
                <RoleBadge role={m.role} />
              )}
            </div>
          );
          return (
            <li key={m.user.id} data-testid="member-row" data-talking={talking || undefined}>
              {talking ? (
                <ElectricBorder
                  color="#5eead4"
                  speed={0.9}
                  chaos={0.35}
                  borderRadius={12}
                  thickness={1.5}
                >
                  {row}
                </ElectricBorder>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
      <Dialog
        open={kickTarget !== null}
        onOpenChange={(o) => {
          if (!o) setKickTarget(null);
        }}
      >
        {kickTarget && (
          <DialogContent
            title="Remove member"
            description={`${kickTarget.user.displayName} will lose access to this room immediately.`}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={ban}
                onChange={(e) => {
                  setBan(e.target.checked);
                }}
              />
              Also block them from rejoining with an invite
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setKickTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={kick.isPending}
                onClick={() => {
                  kick.mutate(
                    { userId: kickTarget.user.id, ban },
                    {
                      onSuccess: () => {
                        setKickTarget(null);
                      },
                      onError: fail,
                    },
                  );
                }}
              >
                Remove
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

/** Unread chat count (FEATURES F9) — text, not colour alone (UI_UX_SPEC §10). */
export function UnreadBadge({ count }: { count: number }) {
  return (
    <span
      role="img"
      data-testid="unread-badge"
      aria-label={`${count} unread`}
      className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] leading-4 font-bold text-accent-fg"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
