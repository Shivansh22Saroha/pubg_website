'use client';

import { type Board, type ShareExpiry, type ShareLink } from '@rotationlab/shared';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useCreateShare, useRevokeShare, useShareStatus } from '@/lib/share';

function expiryText(share: ShareLink) {
  if (!share.expiresAt) return 'Never expires';
  const at = new Date(share.expiresAt);
  return at <= new Date() ? 'Expired' : `Expires ${at.toLocaleString()}`;
}

/**
 * Phase 11 (FEATURES F4b): the board's public read-only link. Only the token's hash is stored,
 * so the address is shown once, right after create / regenerate; afterwards the dialog says a
 * link is active and offers Regenerate (new address, the old one stops working) and Revoke.
 */
export function ShareDialog({
  board,
  open,
  onOpenChange,
}: {
  board: Board;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useShareStatus(board.id, open);
  const create = useCreateShare(board.id);
  const revoke = useRevokeShare(board.id);
  const [expiresIn, setExpiresIn] = useState<ShareExpiry>('7d');
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong');
  const share = status.data ?? null;

  const close = (next: boolean) => {
    if (!next) {
      setUrl(null); // the URL is never kept around once the dialog closes
      setConfirmRevoke(false);
    }
    onOpenChange(next);
  };

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

  const generate = () => {
    create.mutate(expiresIn, {
      onSuccess: (res) => {
        setUrl(res.url);
        setConfirmRevoke(false);
      },
      onError: fail,
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Share read-only link"
        description={`Anyone with the link can view “${board.name}” as it is now — no account, no editing, no chat or member names.`}
        className="max-w-lg"
      >
        {status.isPending ? (
          <Loader2 className="mx-auto size-5 animate-spin text-text-muted" aria-label="Loading" />
        ) : (
          <div className="flex flex-col gap-4" data-testid="share-dialog">
            {url && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={url}
                    aria-label="Share link"
                    data-testid="share-link"
                    onFocus={(e) => {
                      e.target.select();
                    }}
                  />
                  <Button className="h-10" onClick={() => void copy(url)}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-xs text-warning" role="status">
                  Copy it now — for safety the link is only shown once.
                </p>
              </div>
            )}

            {share && (
              <p className="text-sm" data-testid="share-status">
                A link is active · {expiryText(share)} · created{' '}
                {new Date(share.createdAt).toLocaleString()}
              </p>
            )}
            {!share && !url && (
              <p className="text-sm text-text-muted" data-testid="share-status">
                This board has no share link.
              </p>
            )}

            <form
              method="post"
              className="flex items-end gap-2 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                generate();
              }}
            >
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="share-expiry">Expires</Label>
                <NativeSelect
                  id="share-expiry"
                  value={expiresIn}
                  onChange={(e) => {
                    setExpiresIn(e.target.value as ShareExpiry);
                  }}
                >
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="never">Never</option>
                </NativeSelect>
              </div>
              <Button type="submit" disabled={create.isPending} data-testid="share-generate">
                {share ? 'Regenerate link' : 'Create link'}
              </Button>
            </form>

            {share && (
              <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-text-muted">
                <span>
                  {confirmRevoke
                    ? 'Revoke? The link stops working immediately.'
                    : 'Regenerating or revoking stops the current link at once.'}
                </span>
                <Button
                  size="sm"
                  variant={confirmRevoke ? 'destructive' : 'ghost'}
                  className={confirmRevoke ? '' : 'text-danger'}
                  disabled={revoke.isPending}
                  data-testid="share-revoke"
                  onClick={() => {
                    if (!confirmRevoke) {
                      setConfirmRevoke(true);
                      return;
                    }
                    revoke.mutate(undefined, {
                      onSuccess: () => {
                        setUrl(null);
                        setConfirmRevoke(false);
                        toast.success('Share link revoked');
                      },
                      onError: fail,
                    });
                  }}
                >
                  {confirmRevoke ? 'Revoke link' : 'Revoke'}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
