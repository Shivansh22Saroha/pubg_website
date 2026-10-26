'use client';

import type { Me } from '@rotationlab/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, MonitorX, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Avatar({
  user,
  className,
}: {
  user: Pick<Me, 'displayName' | 'avatarColor'>;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 items-center justify-center rounded-full font-display text-sm font-bold text-accent-fg',
        className,
      )}
      // avatarColor is validated as #RRGGBB on the server and in the shared schema (SECURITY V5)
      style={{ backgroundColor: user.avatarColor }}
    >
      {Array.from(user.displayName)[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function UserMenu({ user }: { user: Me }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function logout(path: '/auth/logout' | '/auth/logout-all') {
    setBusy(true);
    try {
      await api(path, { method: 'POST' });
    } catch {
      toast.error('Could not reach the server — you may still be logged in elsewhere.');
    }
    queryClient.clear();
    router.replace('/login');
  }

  const item =
    'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 disabled:opacity-50';
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Account menu"
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-2"
      >
        <Avatar user={user} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-panel border bg-surface p-1 shadow-panel"
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-text-muted">@{user.username}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link
            href="/settings"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
            }}
          >
            <Settings className="size-4" aria-hidden /> Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className={item}
            disabled={busy}
            onClick={() => void logout('/auth/logout')}
          >
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            disabled={busy}
            onClick={() => void logout('/auth/logout-all')}
          >
            <MonitorX className="size-4" aria-hidden /> Log out all devices
          </button>
        </div>
      )}
    </div>
  );
}
