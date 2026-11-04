'use client';

import { formatInviteCode, InvitePreviewSchema, MAPS } from '@rotationlab/shared';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useMe } from '@/hooks/useMe';
import { api, ApiError } from '@/lib/api';
import { useAcceptInvite } from '@/lib/rooms';
import { MapThumb } from './bits';

const MESSAGES: Partial<Record<string, string>> = {
  INVITE_EXPIRED: 'This invite is no longer valid. Ask for a new link.',
  ROOM_LOCKED: "This room isn't accepting new members.",
  NOT_FOUND: 'This invite does not exist. Check the link or code.',
  RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.',
};

/** UI_UX_SPEC §3.4 / UF-5. */
export function JoinCard({ code }: { code: string }) {
  const router = useRouter();
  const me = useMe();
  const loggedOut = me.error instanceof ApiError && me.error.status === 401;
  const preview = useQuery({
    queryKey: ['invite', code],
    queryFn: ({ signal }) => api(`/invites/${code}`, { schema: InvitePreviewSchema, signal }),
  });
  const accept = useAcceptInvite(code);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  // Already a member → straight into the room (UF-5 alternate)
  useEffect(() => {
    const err = accept.error;
    if (err instanceof ApiError && err.code === 'ALREADY_MEMBER') {
      const roomId = err.details.find((d) => d.path === 'roomId')?.issue;
      if (roomId) router.replace(`/rooms/${roomId}`);
    }
  }, [accept.error, router]);

  if (preview.isPending) {
    return (
      <p role="status" className="flex items-center justify-center gap-2 py-8 text-text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading invite…
      </p>
    );
  }
  if (preview.error) {
    const msg =
      preview.error instanceof ApiError
        ? (MESSAGES[preview.error.code] ?? preview.error.message)
        : 'Could not load this invite.';
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="font-display text-[30px] leading-none font-bold">Invite not found</h1>
        <p role="alert" className="text-text-muted">
          {msg}
        </p>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
          Go to dashboard
        </Link>
      </div>
    );
  }

  const { room, valid } = preview.data;
  const join = () => {
    setError(null);
    accept.mutate(room.hasPassword ? password : undefined, {
      onSuccess: ({ roomId }) => {
        router.push(`/rooms/${roomId}`);
      },
      onError: (err) => {
        if (!(err instanceof ApiError) || err.code === 'ALREADY_MEMBER') return;
        if (err.code === 'WRONG_ROOM_PASSWORD')
          setError({ field: 'password', message: 'Wrong room password' });
        else if (err.code === 'LIMIT_REACHED') setError({ message: err.message });
        else setError({ message: MESSAGES[err.code] ?? err.message });
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="section-label text-xs text-text-muted">You're invited to</p>
        <h1
          className="font-display text-[30px] leading-none font-bold"
          data-testid="join-room-name"
        >
          {room.name}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-text-muted">
          by {room.ownerName} · <Users className="size-3.5" aria-hidden /> {room.memberCount} member
          {room.memberCount === 1 ? '' : 's'}
          {room.hasPassword && <Lock className="size-3.5" aria-label="Password protected" />}
        </p>
      </div>
      {room.maps.length > 0 && (
        <div className="flex gap-2">
          {room.maps.map((m) => (
            <figure key={m} className="w-20">
              <MapThumb mapId={m} className="aspect-square rounded-control" />
              <figcaption className="mt-1 text-center text-xs text-text-muted">
                {MAPS[m].name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="font-mono text-xs text-text-muted">Code {formatInviteCode(code)}</p>

      {!valid ? (
        <p
          role="alert"
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {MESSAGES.INVITE_EXPIRED}
        </p>
      ) : me.isPending ? (
        <Loader2
          className="mx-auto size-5 animate-spin text-text-muted"
          aria-label="Checking your session"
        />
      ) : loggedOut ? (
        <div className="flex flex-col gap-2">
          <Link
            href={`/login?redirectTo=${encodeURIComponent(`/join/${code}`)}`}
            className={buttonVariants({ className: 'h-10' })}
          >
            Log in to join
          </Link>
          <Link
            href={`/register?redirectTo=${encodeURIComponent(`/join/${code}`)}`}
            className={buttonVariants({ variant: 'ghost', className: 'h-10' })}
          >
            Create an account
          </Link>
        </div>
      ) : (
        <form
          method="post"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          {room.hasPassword && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-password">Room password</Label>
              <Input
                id="room-password"
                type="password"
                autoComplete="off"
                value={password}
                aria-invalid={error?.field === 'password' ? true : undefined}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
              />
              <FieldError id="room-password-error">
                {error?.field === 'password' ? error.message : undefined}
              </FieldError>
            </div>
          )}
          {error && !error.field && (
            <p role="alert" data-testid="form-error" className="text-sm text-danger">
              {error.message}
            </p>
          )}
          <Button type="submit" className="h-10" disabled={accept.isPending}>
            {accept.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Join room
          </Button>
        </form>
      )}
    </div>
  );
}
