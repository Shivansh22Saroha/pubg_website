'use client';

import { can, type AssignableRole, type Member, type RoomRole } from '@rotationlab/shared';
import { Eye, EyeOff, Lock, LockOpen, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/auth/UserMenu';
import { RoleBadge } from '@/components/rooms/bits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { useBoardState, useKickMember, useSetMemberRole } from '@/lib/rooms';

/** Right panel (UI_UX_SPEC §3.5): Chat · Layers · Members. */
export function SidePanel({
  roomId,
  role,
  meId,
  members,
  boardId,
}: {
  roomId: string;
  role: RoomRole;
  meId: string;
  members: Member[];
  boardId: string | undefined;
}) {
  return (
    <Tabs defaultValue="members" className="flex h-full flex-col">
      <TabsList>
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="layers">Layers</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
      </TabsList>
      <TabsContent
        value="chat"
        className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-text-muted"
      >
        <MessageSquare className="size-6" aria-hidden />
        Room chat with map pings arrives with live collaboration.
      </TabsContent>
      <TabsContent value="layers" className="overflow-y-auto p-2">
        <LayersList boardId={boardId} />
      </TabsContent>
      <TabsContent value="members" className="overflow-y-auto p-2">
        <MembersList roomId={roomId} role={role} meId={meId} members={members} />
      </TabsContent>
    </Tabs>
  );
}

/** Read-only in Phase 4; layer editing goes over the socket (Phase 5/6). */
function LayersList({ boardId }: { boardId: string | undefined }) {
  const state = useBoardState(boardId);
  if (!state.data) return <p className="p-2 text-sm text-text-muted">Loading layers…</p>;
  return (
    <ul className="flex flex-col" aria-label="Layers">
      {state.data.layers.map((l) => (
        <li
          key={l.id}
          className="flex items-center gap-2 rounded-control px-2 py-2 text-sm hover:bg-surface-2"
        >
          {/* color validated as #RRGGBB (SECURITY V5) */}
          <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: l.color }} />
          <span className="flex-1 truncate">{l.name}</span>
          {l.visible ? (
            <Eye className="size-4 text-text-muted" aria-label="Visible" />
          ) : (
            <EyeOff className="size-4 text-text-muted" aria-label="Hidden" />
          )}
          {l.locked ? (
            <Lock className="size-4 text-text-muted" aria-label="Locked" />
          ) : (
            <LockOpen className="size-4 text-text-muted opacity-40" aria-label="Unlocked" />
          )}
        </li>
      ))}
    </ul>
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
  const sorted = [...members].sort((a, b) => Number(b.online) - Number(a.online));

  return (
    <>
      <ul className="flex flex-col" aria-label="Members">
        {sorted.map((m) => (
          <li
            key={m.user.id}
            className="flex items-center gap-2 rounded-control px-2 py-2 hover:bg-surface-2"
            data-testid="member-row"
          >
            <Avatar user={m.user} className="size-7 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.user.displayName}
                {m.user.id === meId && <span className="text-text-muted"> (you)</span>}
              </p>
              <p className="truncate text-xs text-text-muted">@{m.user.username}</p>
            </div>
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
          </li>
        ))}
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
