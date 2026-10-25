'use client';

import type { Member } from '@rotationlab/shared';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/auth/UserMenu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { resumeRealtime, useConnection } from '@/lib/realtime/socket';
import { cn } from '@/lib/utils';
import { selectPendingCount, selectQueueFull, useBoardStore } from '@/stores/boardStore';
import { usePresenceStore } from '@/stores/presenceStore';

export type SyncState = 'synced' | 'saving' | 'reconnecting' | 'offline';

export function syncState(input: { status: string; online: boolean; pending: number }): SyncState {
  if (!input.online) return 'offline';
  if (input.status !== 'connected') return 'reconnecting';
  return input.pending > 0 ? 'saving' : 'synced';
}

const LABEL: Record<SyncState, string> = {
  synced: 'Synced',
  saving: 'Saving…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline — changes will sync',
};
const STYLE: Record<SyncState, string> = {
  synced: 'text-success',
  saving: 'text-text-muted',
  reconnecting: 'text-warning',
  offline: 'text-danger',
};
const GLYPH: Record<SyncState, string> = {
  synced: '●',
  saving: '◌',
  reconnecting: '▲',
  offline: '✕',
};

/** UI_UX_SPEC §3.5 sync indicator — text + glyph, never colour alone (§10). */
export function SyncIndicator() {
  const status = useConnection((s) => s.status);
  const online = useConnection((s) => s.online);
  const pending = useBoardStore(selectPendingCount);
  const full = useBoardStore(selectQueueFull);
  const state = syncState({ status, online, pending });
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="sync-indicator"
      data-state={state}
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
        STYLE[state],
      )}
      title={
        full ? 'Too many unsynced changes — editing is paused until you are back online' : undefined
      }
    >
      <span aria-hidden>{GLYPH[state]}</span>
      <span className="hidden lg:inline">{full ? 'Offline — edit queue full' : LABEL[state]}</span>
    </span>
  );
}

/** Top-bar presence: up to 5 online avatars with presence-colour rings, then +N. */
export function PresenceStack({ members }: { members: Member[] }) {
  const users = usePresenceStore((s) => s.users);
  const online = members.filter((m) => m.user.id in users);
  const shown = online.slice(0, 5);
  return (
    <div
      className="hidden items-center -space-x-1.5 md:flex"
      aria-label={`${online.length} online`}
      data-testid="presence-stack"
    >
      {shown.map((m) => {
        const p = users[m.user.id];
        return (
          <span
            key={m.user.id}
            title={`${m.user.displayName}${p?.idle ? ' (idle)' : ''}`}
            data-testid="presence-avatar"
            data-user={m.user.username}
            className={cn(
              'rounded-full ring-2 ring-offset-1 ring-offset-bg',
              p?.idle && 'opacity-50',
            )}
            // presence colours come from a fixed server-side palette
            style={{ ['--tw-ring-color' as string]: p?.color }}
          >
            <Avatar user={m.user} className="size-7 text-xs" />
          </span>
        );
      })}
      {online.length > 5 && (
        <span className="pl-3 text-xs text-text-muted">+{online.length - 5}</span>
      )}
    </div>
  );
}

/** Blocking modal when the room is gone for this user (UI_UX_SPEC §9). */
export function RoomGoneDialog({ reason }: { reason: 'kicked' | 'deleted' | null }) {
  const router = useRouter();
  return (
    <Dialog open={reason !== null}>
      {reason && (
        <DialogContent
          title={
            reason === 'kicked'
              ? 'You were removed from this room'
              : 'This room was deleted by the owner'
          }
          onEscapeKeyDown={(e) => {
            e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
          }}
        >
          <Button
            data-testid="room-gone-dashboard"
            onClick={() => {
              router.replace('/dashboard');
            }}
          >
            Back to dashboard
          </Button>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** The refresh token is gone too: log in again; unsent changes stay in this tab meanwhile. */
export function SessionExpiredDialog() {
  const expired = useConnection((s) => s.sessionExpired);
  const pending = useBoardStore(selectPendingCount);
  return (
    <Dialog open={expired}>
      {expired && (
        <DialogContent
          title="Your session expired"
          description={
            pending > 0
              ? `${pending} unsaved change${pending === 1 ? '' : 's'} will sync after you log in again. Keep this tab open.`
              : 'Log in again to keep collaborating.'
          }
        >
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                window.open('/login', '_blank', 'noopener');
              }}
            >
              Log in (new tab)
            </Button>
            <Button variant="ghost" onClick={resumeRealtime}>
              I’ve logged in — reconnect
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
