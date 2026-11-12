'use client';

import {
  MembersResponseSchema,
  PRESENCE_COLORS,
  type Member,
  type Me,
  type OwnedRoomChoice,
  type RoomSummary,
} from '@rotationlab/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/auth/UserMenu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { useMe } from '@/hooks/useMe';
import {
  deleteAccount,
  useChangePassword,
  useRevokeSession,
  useSessions,
  useUpdateMe,
} from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { useRooms } from '@/lib/rooms';
import { cn } from '@/lib/utils';

const fail = (err: unknown) => {
  toast.error(err instanceof ApiError ? err.message : 'Something went wrong');
};

function Section({
  title,
  children,
  danger,
}: {
  title: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      aria-labelledby={`s-${title}`}
      className={cn(
        'flex flex-col gap-4 rounded-panel border bg-surface p-5',
        danger && 'border-danger/60',
      )}
    >
      <h2
        id={`s-${title}`}
        className={cn('font-display text-xl font-bold', danger && 'text-danger')}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

/** `/settings` (UI_UX_SPEC §3.9, UF-14): Profile · Account · Sessions · Danger zone. */
export function SettingsPage() {
  const me = useMe();
  if (!me.data) return null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-[32px] leading-tight font-bold">Settings</h1>
      <Profile me={me.data} />
      <Account me={me.data} />
      <Sessions />
      <Danger me={me.data} />
    </div>
  );
}

function Profile({ me }: { me: Me }) {
  const update = useUpdateMe();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [ign, setIgn] = useState(me.ign ?? '');
  const [color, setColor] = useState(me.avatarColor.toUpperCase());
  const dirty =
    displayName.trim() !== me.displayName ||
    ign.trim() !== (me.ign ?? '') ||
    color !== me.avatarColor.toUpperCase();
  return (
    <Section title="Profile">
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate(
            {
              displayName: displayName.trim(),
              ign: ign.trim() ? ign.trim() : null,
              avatarColor: color,
            },
            { onSuccess: () => toast.success('Profile saved'), onError: fail },
          );
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar
            user={{ displayName: displayName || me.displayName, avatarColor: color }}
            className="size-12 text-lg"
          />
          <p className="text-sm text-text-muted">@{me.username}</p>
        </div>
        <Field label="Display name">
          <Input
            value={displayName}
            maxLength={32}
            required
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
          />
        </Field>
        <Field label="In-game name (IGN)" hint="Shown to your squad; leave empty to hide.">
          <Input
            value={ign}
            maxLength={32}
            onChange={(e) => {
              setIgn(e.target.value);
            }}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1.5 font-medium">Avatar colour</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Avatar colour">
            {PRESENCE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                onClick={() => {
                  setColor(c);
                }}
                className={cn(
                  'size-7 rounded-full border-2 border-transparent',
                  color === c && 'border-text',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </fieldset>
        <div>
          <Button type="submit" disabled={!dirty || !displayName.trim() || update.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Account({ me }: { me: Me }) {
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  return (
    <Section title="Account">
      <Field label="Email" hint={me.emailVerified ? 'Verified' : 'Not verified yet'}>
        <Input value={me.email} readOnly aria-readonly />
      </Field>
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate(
            me.hasPassword
              ? { currentPassword: current, newPassword: next }
              : { newPassword: next },
            {
              onSuccess: () => {
                setCurrent('');
                setNext('');
                toast.success(
                  me.hasPassword
                    ? 'Password changed — your other devices were logged out'
                    : 'Password set — you can now log in with it as well as with Google',
                );
              },
              onError: fail,
            },
          );
        }}
      >
        {me.hasPassword ? (
          <Field label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
              }}
            />
          </Field>
        ) : (
          <p className="text-sm text-text-muted" data-testid="google-no-password">
            You sign in with Google. Set a password to also log in with your email — it&apos;s
            needed to delete your account or hand a room to someone else.
          </p>
        )}
        <Field
          label="New password"
          hint="10–128 characters. Changing it logs out your other devices."
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
            }}
          />
        </Field>
        <div>
          <Button
            type="submit"
            disabled={(me.hasPassword && !current) || next.length < 10 || change.isPending}
          >
            {me.hasPassword ? 'Change password' : 'Set password'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Sessions() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Section title="Sessions">
      {sessions.isPending && (
        <Loader2 className="size-4 animate-spin text-text-muted" aria-label="Loading" />
      )}
      <ul className="flex flex-col gap-2" aria-label="Sessions" data-testid="sessions">
        {sessions.data?.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-control border px-3 py-2 text-sm"
          >
            <Monitor className="size-4 shrink-0 text-text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate">{s.userAgent ?? 'Unknown device'}</p>
              <p className="text-xs text-text-muted">
                Since {new Date(s.createdAt).toLocaleString()}
                {s.current && <span className="ml-2 font-semibold text-success">This device</span>}
              </p>
            </div>
            {!s.current && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  revoke.mutate(s.id, { onError: fail });
                }}
              >
                Log out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            api('/auth/logout-all', { method: 'POST' })
              .catch(() => undefined)
              .finally(() => {
                qc.clear();
                router.replace('/login');
              });
          }}
        >
          Log out of all devices
        </Button>
      </div>
    </Section>
  );
}

/** For each owned room: a member to hand it to, or delete it. Mirrors the server's fallback. */
export function defaultChoice(members: Member[], meId: string): string {
  const editor = members
    .filter((m) => m.user.id !== meId && m.role === 'EDITOR')
    .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt))[0];
  return editor ? editor.user.id : 'delete';
}

function Danger({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Danger zone" danger>
      <p className="text-sm text-text-muted">
        Deleting your account removes your login, profile and memberships. Your chat messages stay
        without your name. Rooms you own are handed over or deleted — you choose below.
      </p>
      <div>
        <Button
          variant="destructive"
          onClick={() => {
            setOpen(true);
          }}
        >
          Delete account
        </Button>
      </div>
      {open && (
        <DeleteAccountDialog
          me={me}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </Section>
  );
}

function DeleteAccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const rooms = useRooms();
  const owned = (rooms.data ?? []).filter((r) => r.role === 'OWNER');
  const members = useQueries({
    queries: owned.map((r) => ({
      queryKey: ['room', r.id, 'members'],
      queryFn: async () =>
        (await api(`/rooms/${r.id}/members`, { schema: MembersResponseSchema })).items,
    })),
  });
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const loaded = !rooms.isPending && members.every((m) => !m.isPending);

  const choiceOf = (r: RoomSummary, i: number) =>
    choices[r.id] ?? defaultChoice(members[i]?.data ?? [], me.id);

  const submit = () => {
    const list: OwnedRoomChoice[] = owned.map((r, i) => {
      const c = choiceOf(r, i);
      return c === 'delete'
        ? { roomId: r.id, action: 'delete' }
        : { roomId: r.id, action: 'transfer', toUserId: c };
    });
    setBusy(true);
    deleteAccount({ password, confirm: 'DELETE', rooms: list })
      .then(() => {
        qc.clear();
        router.replace('/'); // UF-14 → landing
      })
      .catch((err: unknown) => {
        setBusy(false);
        fail(err);
      });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title="Delete your account"
        description="This can’t be undone. Every device is logged out."
        className="max-w-lg"
      >
        {!loaded ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your rooms…
          </p>
        ) : owned.length > 0 ? (
          <div className="flex flex-col gap-3" data-testid="owned-rooms">
            <p className="text-sm">
              You own {owned.length === 1 ? 'a room' : `${owned.length} rooms`}. For each, pick a
              new owner or delete it:
            </p>
            {owned.map((r, i) => {
              const others = (members[i]?.data ?? []).filter((m) => m.user.id !== me.id);
              return (
                <label key={r.id} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{r.name}</span>
                  <NativeSelect
                    aria-label={`What happens to ${r.name}`}
                    value={choiceOf(r, i)}
                    onChange={(e) => {
                      setChoices((c) => ({ ...c, [r.id]: e.target.value }));
                    }}
                  >
                    {others.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        Transfer to {m.user.displayName} (
                        {m.role === 'EDITOR' ? 'Editor' : 'Viewer'})
                      </option>
                    ))}
                    <option value="delete">Delete the room</option>
                  </NativeSelect>
                </label>
              );
            })}
          </div>
        ) : null}
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </Field>
        <Field label="Type DELETE to confirm">
          <Input
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!loaded || !password || confirm !== 'DELETE' || busy}
            onClick={submit}
          >
            Delete account
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
