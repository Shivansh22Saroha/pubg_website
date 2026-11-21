'use client';

import type { Me, RoomRole } from '@rotationlab/shared';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/auth/UserMenu';
import { useRemoveAvatar, useSetAvatar } from '@/lib/account';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<RoomRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

/**
 * Your avatar in the room's action cluster (exact room demo): an amber ring; clicking it opens a
 * glass profile card where you upload, change or remove your profile photo (F23).
 */
export function ProfileCard({ me, role, roomName }: { me: Me; role: RoomRole; roomName: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const set = useSetAvatar();
  const remove = useRemoveAvatar();
  const busy = set.isPending || remove.isPending;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  const fail = (err: unknown) => {
    setError(
      err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong',
    );
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Your profile"
        aria-expanded={open}
        data-testid="profile-button"
        onClick={() => {
          setOpen((o) => !o);
          setError('');
        }}
        className="grid size-[38px] place-items-center rounded-full border-2 border-accent/70 hover:border-accent"
      >
        <Avatar user={me} className="size-8 text-[13px]" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Your profile"
          data-testid="profile-card"
          className="glass-panel rl-fade-in absolute top-[calc(100%+14px)] right-0 z-50 flex w-[280px] origin-top-right flex-col gap-2.5 p-4"
        >
          <div className="flex items-center gap-3">
            <Avatar
              user={me}
              className="size-16 text-2xl shadow-[0_0_0_3px_rgba(245,185,66,0.5)]"
            />
            <div className="flex min-w-0 flex-col">
              <b className="truncate font-display text-[17px]">{me.displayName}</b>
              <span className="truncate text-xs text-text-muted">
                {ROLE_LABEL[role]} · {roomName}
              </span>
            </div>
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            data-testid="profile-photo-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setError('');
              set.mutate(file, {
                onSuccess: () => toast.success('Profile photo updated'),
                onError: fail,
              });
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="h-[38px] rounded-[11px] bg-accent px-3.5 text-[13px] font-semibold text-accent-fg hover:bg-accent-hi disabled:opacity-60"
          >
            {set.isPending ? 'Uploading…' : me.avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          {me.avatarUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('');
                remove.mutate(undefined, {
                  onSuccess: () => toast.success('Profile photo removed'),
                  onError: fail,
                });
              }}
              className="h-[38px] rounded-[11px] border border-[var(--edge-strong)] bg-white/[0.04] px-3.5 text-[13px] font-semibold hover:bg-white/[0.08] disabled:opacity-60"
            >
              Remove photo
            </button>
          )}
          <p
            className={cn('m-0 text-xs', error ? 'text-danger' : 'text-text-muted')}
            role={error ? 'alert' : undefined}
          >
            {error || 'JPG, PNG or WebP. Cropped to a circle, shown only to people in your rooms.'}
          </p>
        </div>
      )}
    </div>
  );
}
