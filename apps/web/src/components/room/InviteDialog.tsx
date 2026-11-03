'use client';

import {
  formatInviteCode,
  type AssignableRole,
  type Invite,
  type RoomRole,
} from '@rotationlab/shared';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useCreateInvite, useInvites, useRevokeInvite } from '@/lib/rooms';

type Expiry = '1h' | '24h' | '7d' | 'never';

function expiryLabel(i: Invite) {
  if (!i.expiresAt) return 'never expires';
  return `expires ${new Date(i.expiresAt).toLocaleString()}`;
}

/**
 * UI_UX_SPEC §3.7 / UF-4: current link + copy, big code, expiry / max uses / role,
 * "Generate new link", list of active invites with Revoke. Opens with a 24 h link ready.
 */
export function InviteDialog({
  roomId,
  role,
  defaultRole,
  open,
  onOpenChange,
}: {
  roomId: string;
  role: RoomRole;
  defaultRole: AssignableRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invites = useInvites(roomId, open);
  const create = useCreateInvite(roomId);
  const revoke = useRevokeInvite(roomId);
  const [expiresIn, setExpiresIn] = useState<Expiry>('24h');
  const [maxUses, setMaxUses] = useState('');
  const [inviteRole, setInviteRole] = useState<AssignableRole>(defaultRole);
  const [copied, setCopied] = useState(false);
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong');

  const current = invites.data?.[0];

  // first open with no active invite → create the default 24 h one
  const { mutate: createInvite, isPending: creating } = create;
  const empty = invites.isSuccess && invites.data.length === 0;
  const autoCreated = useRef(false); // once per dialog lifetime, even before the list refetches
  useEffect(() => {
    if (open && empty && !creating && !autoCreated.current) {
      autoCreated.current = true;
      createInvite({ expiresIn: '24h' });
    }
  }, [open, empty, creating, createInvite]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.error('Copy failed — select the link and copy it manually');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Invite teammates"
        description="Share the link or the code."
        className="max-w-lg"
      >
        {!current ? (
          <Loader2
            className="mx-auto size-5 animate-spin text-text-muted"
            aria-label="Creating invite"
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                readOnly
                value={current.url}
                aria-label="Invite link"
                data-testid="invite-link"
                onFocus={(e) => {
                  e.target.select();
                }}
              />
              <Button className="h-10" onClick={() => void copy(current.url)}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p
              className="text-center font-mono text-3xl font-medium tracking-wider"
              data-testid="invite-code"
            >
              {formatInviteCode(current.code)}
            </p>
            <p className="text-center text-xs text-text-muted">
              Joins as {current.role === 'EDITOR' ? 'Editor' : 'Viewer'} · {expiryLabel(current)}
              {current.maxUses ? ` · ${current.useCount}/${current.maxUses} uses` : ''}
            </p>
          </div>
        )}

        <form
          method="post"
          className="grid grid-cols-3 gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const uses = maxUses ? Number(maxUses) : undefined;
            create.mutate(
              { expiresIn, role: inviteRole, ...(uses ? { maxUses: uses } : {}) },
              { onError: fail },
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-expiry">Expires</Label>
            <NativeSelect
              id="invite-expiry"
              value={expiresIn}
              onChange={(e) => {
                setExpiresIn(e.target.value as Expiry);
              }}
            >
              <option value="1h">1 hour</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="never">Never</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-uses">Max uses</Label>
            <Input
              id="invite-uses"
              type="number"
              min={1}
              max={100}
              placeholder="∞"
              value={maxUses}
              onChange={(e) => {
                setMaxUses(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-role">Joins as</Label>
            <NativeSelect
              id="invite-role"
              value={inviteRole}
              onChange={(e) => {
                setInviteRole(e.target.value as AssignableRole);
              }}
            >
              <option value="EDITOR" disabled={role === 'VIEWER'}>
                Editor
              </option>
              <option value="VIEWER">Viewer</option>
            </NativeSelect>
          </div>
          <Button
            type="submit"
            variant="outline"
            className="col-span-3"
            disabled={create.isPending}
          >
            Generate new link
          </Button>
        </form>

        {(invites.data?.length ?? 0) > 1 && (
          <div className="flex flex-col gap-1 border-t pt-3">
            <h3 className="section-label text-xs text-text-muted">Active invites</h3>
            <ul className="flex flex-col">
              {invites.data?.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="font-mono">{formatInviteCode(i.code)}</span>
                  <span className="flex-1 truncate text-text-muted">
                    {i.role === 'EDITOR' ? 'Editor' : 'Viewer'} · {i.useCount}
                    {i.maxUses ? `/${i.maxUses}` : ''} uses · {expiryLabel(i)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    disabled={revoke.isPending}
                    onClick={() => {
                      revoke.mutate(i.id, { onError: fail });
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
