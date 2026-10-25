'use client';

import type { AssignableRole, Member, RoomDetail } from '@rotationlab/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FieldError, Input, Label } from '@/components/ui/input';
import { NativeSelect, Textarea } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import {
  useBans,
  useDeleteRoom,
  useSetRoomPassword,
  useTransferRoom,
  useUnban,
  useUpdateRoom,
} from '@/lib/rooms';

const errMsg = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong');

/** UI_UX_SPEC §3.6 — General / Security / Danger zone. Owner only. */
export function RoomSettingsDialog({
  room,
  members,
  open,
  onOpenChange,
}: {
  room: RoomDetail;
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const update = useUpdateRoom(room.id);
  const setPassword = useSetRoomPassword(room.id);
  const transfer = useTransferRoom(room.id);
  const del = useDeleteRoom(room.id);

  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? '');
  const [defaultRole, setDefaultRole] = useState<AssignableRole>(room.defaultRole);
  const [newPassword, setNewPassword] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferPassword, setTransferPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<{ tab: string; message: string } | null>(null);

  const others = members.filter((m) => m.role !== 'OWNER');
  const done = (msg: string) => {
    setError(null);
    toast.success(msg);
  };
  const fail = (tab: string) => (err: unknown) => {
    setError({ tab, message: errMsg(err) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Room settings" className="max-w-lg">
        <Tabs defaultValue="general" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate(
                  { name, description: description || null, defaultRole },
                  {
                    onSuccess: () => {
                      done('Room updated');
                    },
                    onError: fail('general'),
                  },
                );
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-name">Name</Label>
                <Input
                  id="settings-name"
                  value={name}
                  maxLength={40}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-description">Description</Label>
                <Textarea
                  id="settings-description"
                  rows={2}
                  maxLength={280}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-role">New members join as</Label>
                <NativeSelect
                  id="settings-role"
                  value={defaultRole}
                  onChange={(e) => {
                    setDefaultRole(e.target.value as AssignableRole);
                  }}
                >
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </NativeSelect>
              </div>
              <FieldError id="general-error">
                {error?.tab === 'general' ? error.message : undefined}
              </FieldError>
              <Button type="submit" disabled={update.isPending}>
                Save
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="security" className="flex flex-col gap-5">
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setPassword.mutate(newPassword, {
                  onSuccess: () => {
                    setNewPassword('');
                    done('Room password set');
                  },
                  onError: fail('security'),
                });
              }}
            >
              <Label htmlFor="settings-password">
                Room password {room.hasPassword ? '(set)' : '(none)'}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="settings-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={room.hasPassword ? 'New password' : 'Set a password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                  }}
                />
                <Button
                  type="submit"
                  className="h-10"
                  disabled={newPassword.length < 4 || setPassword.isPending}
                >
                  Set
                </Button>
              </div>
              {room.hasPassword && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setPassword.mutate(null, {
                      onSuccess: () => {
                        done('Room password removed');
                      },
                      onError: fail('security'),
                    });
                  }}
                >
                  Remove password
                </Button>
              )}
            </form>
            <label className="flex items-center justify-between gap-3 rounded-control border p-3 text-sm">
              <span>
                <span className="block font-medium">Lock room</span>
                <span className="text-xs text-text-muted">
                  No one new can join, even with an invite.
                </span>
              </span>
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={room.isLocked}
                onChange={(e) => {
                  update.mutate(
                    { isLocked: e.target.checked },
                    {
                      onSuccess: () => {
                        done(e.target.checked ? 'Room locked' : 'Room unlocked');
                      },
                      onError: fail('security'),
                    },
                  );
                }}
              />
            </label>
            <BlockedUsers roomId={room.id} />
            <FieldError id="security-error">
              {error?.tab === 'security' ? error.message : undefined}
            </FieldError>
          </TabsContent>

          <TabsContent value="danger" className="flex flex-col gap-5">
            <form
              className="flex flex-col gap-2 rounded-control border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                transfer.mutate(
                  { userId: transferTo, password: transferPassword },
                  {
                    onSuccess: () => {
                      setTransferPassword('');
                      done('Ownership transferred');
                      onOpenChange(false);
                    },
                    onError: fail('danger'),
                  },
                );
              }}
            >
              <h3 className="font-medium">Transfer ownership</h3>
              <NativeSelect
                aria-label="New owner"
                value={transferTo}
                onChange={(e) => {
                  setTransferTo(e.target.value);
                }}
              >
                <option value="">Choose a member…</option>
                {others.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.displayName} (@{m.user.username})
                  </option>
                ))}
              </NativeSelect>
              <Input
                type="password"
                autoComplete="current-password"
                aria-label="Your account password"
                placeholder="Your account password"
                value={transferPassword}
                onChange={(e) => {
                  setTransferPassword(e.target.value);
                }}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!transferTo || !transferPassword || transfer.isPending}
              >
                Transfer ownership
              </Button>
            </form>
            <form
              className="flex flex-col gap-2 rounded-control border border-danger/40 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                del.mutate(confirmName, {
                  onSuccess: () => {
                    toast.success('Room deleted');
                    router.replace('/dashboard');
                  },
                  onError: fail('danger'),
                });
              }}
            >
              <h3 className="font-medium text-danger">Delete room</h3>
              <p className="text-xs text-text-muted">
                Type “{room.name}” to confirm. Everyone loses access.
              </p>
              <Input
                aria-label="Room name to confirm"
                value={confirmName}
                onChange={(e) => {
                  setConfirmName(e.target.value);
                }}
              />
              <Button
                type="submit"
                variant="destructive"
                disabled={confirmName !== room.name || del.isPending}
              >
                Delete room
              </Button>
            </form>
            <FieldError id="danger-error">
              {error?.tab === 'danger' ? error.message : undefined}
            </FieldError>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Kicked-and-blocked users (room_bans) with Unban. */
function BlockedUsers({ roomId }: { roomId: string }) {
  const bans = useBans(roomId, true);
  const unban = useUnban(roomId);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="blocked-heading">
      <h3 id="blocked-heading" className="text-sm font-medium">
        Blocked users
      </h3>
      {!bans.data ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : bans.data.length === 0 ? (
        <p className="text-xs text-text-muted">
          Nobody is blocked. Kick with “block” to stop someone rejoining.
        </p>
      ) : (
        <ul className="flex flex-col">
          {bans.data.map((b) => (
            <li
              key={b.user.id}
              className="flex items-center justify-between gap-2 py-1 text-sm"
              data-testid="ban-row"
            >
              <span className="truncate">
                {b.user.displayName} <span className="text-text-muted">@{b.user.username}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={unban.isPending}
                onClick={() => {
                  unban.mutate(b.user.id, {
                    onSuccess: () => toast.success(`${b.user.displayName} can join again`),
                    onError: (err) => toast.error(errMsg(err)),
                  });
                }}
              >
                Unban
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
