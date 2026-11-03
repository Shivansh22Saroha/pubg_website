'use client';

import {
  can,
  SNAPSHOT_LIMITS,
  type Board,
  type RoomRole,
  type Snapshot,
} from '@rotationlab/shared';
import { History, Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  useCreateSnapshot,
  useDeleteSnapshot,
  usePrefetchSnapshot,
  useRestoreSnapshot,
  useSnapshotDetail,
  useSnapshots,
} from '@/lib/snapshots';
import { cn } from '@/lib/utils';

// Leaflet touches `window` at import time → client-only
const SnapshotPreviewMap = dynamic(() => import('./SnapshotPreviewMap'), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-text-muted">Loading preview…</p>,
});

const fail = (err: unknown) => {
  toast.error(err instanceof ApiError ? err.message : 'Something went wrong');
};

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Snapshots drawer (UI_UX_SPEC §3.8, FEATURES F10, UF-11): save (Editor+), list (name, author,
 * time, element count, auto tag), a read-only preview in a modal map, restore with a confirm
 * (the current board is auto-saved first), delete for the owner or the author.
 */
export function SnapshotsDrawer({
  board,
  role,
  meId,
  onClose,
}: {
  board: Board;
  role: RoomRole;
  meId: string;
  onClose: () => void;
}) {
  const list = useSnapshots(board.id, true);
  const create = useCreateSnapshot(board.id);
  const prefetch = usePrefetchSnapshot();
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const canSave = can(role, 'board.manage');
  const trimmed = name.trim();

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title="Snapshots"
        description={board.name}
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-[min(420px,100vw)] max-w-none translate-x-0 translate-y-0 rounded-none"
        data-testid="snapshots-drawer"
      >
        {canSave && (
          <form
            method="post"
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!trimmed) return;
              create.mutate(trimmed, {
                onSuccess: () => {
                  setName('');
                  toast.success('Snapshot saved');
                },
                onError: fail,
              });
            }}
          >
            <Input
              aria-label="Snapshot name"
              placeholder="Plan A – north zone"
              maxLength={SNAPSHOT_LIMITS.nameMax}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <Button type="submit" disabled={!trimmed || create.isPending}>
              Save snapshot
            </Button>
          </form>
        )}
        {list.isPending && (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {list.data?.length === 0 && (
          <p className="text-sm text-text-muted">
            No snapshots yet{canSave ? ' — save one to come back to this plan later.' : '.'}
          </p>
        )}
        <ul className="flex flex-col gap-1" aria-label="Snapshots" data-testid="snapshot-list">
          {list.data?.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                data-testid="snapshot-item"
                data-name={s.name}
                onMouseEnter={() => {
                  void prefetch(s.id);
                }}
                onFocus={() => {
                  void prefetch(s.id);
                }}
                onClick={() => {
                  setPreview(s);
                }}
                className="flex w-full flex-col gap-0.5 rounded-control border px-3 py-2 text-left hover:border-accent"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {s.isAuto && (
                    <History className="size-3.5 shrink-0 text-text-muted" aria-hidden />
                  )}
                  <span className="truncate">{s.name}</span>
                  {s.isAuto && (
                    <span className="ml-auto rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
                      auto
                    </span>
                  )}
                </span>
                <span className="text-xs text-text-muted">
                  {s.createdBy?.displayName ?? 'Former member'} · {when(s.createdAt)} ·{' '}
                  {s.elementCount} element{s.elementCount === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
      {preview && (
        <PreviewDialog
          snapshot={preview}
          board={board}
          canRestore={canSave}
          canDelete={preview.createdBy?.id === meId || can(role, 'room.manage')}
          onClose={() => {
            setPreview(null);
          }}
          onRestored={onClose}
        />
      )}
    </Dialog>
  );
}

function PreviewDialog({
  snapshot,
  board,
  canRestore,
  canDelete,
  onClose,
  onRestored,
}: {
  snapshot: Snapshot;
  board: Board;
  canRestore: boolean;
  canDelete: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const detail = useSnapshotDetail(snapshot.id);
  const restore = useRestoreSnapshot(board.id);
  const remove = useDeleteSnapshot(board.id);
  const [confirm, setConfirm] = useState<'restore' | 'delete' | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        title={snapshot.name}
        description={`${snapshot.elementCount} element${snapshot.elementCount === 1 ? '' : 's'} · ${when(snapshot.createdAt)}${snapshot.isAuto ? ' · automatic' : ''}`}
        className="max-w-4xl"
      >
        {detail.data ? (
          <SnapshotPreviewMap mapId={board.mapId} boardId={board.id} data={detail.data.data} />
        ) : (
          <p className="p-6 text-sm text-text-muted">Loading preview…</p>
        )}
        {confirm ? (
          <div
            className={cn(
              'flex flex-wrap items-center justify-end gap-2 rounded-control border p-3 text-sm',
              confirm === 'delete' && 'border-danger',
            )}
            role="alertdialog"
            aria-label={confirm === 'restore' ? 'Confirm restore' : 'Confirm delete'}
          >
            <span className="mr-auto">
              {confirm === 'restore'
                ? 'Restore this snapshot for everyone? The current board will be auto-saved first.'
                : 'Delete this snapshot? This can’t be undone.'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={confirm === 'delete' ? 'destructive' : 'accent'}
              data-testid={`confirm-snapshot-${confirm}`}
              disabled={restore.isPending || remove.isPending}
              onClick={() => {
                if (confirm === 'restore') {
                  restore.mutate(snapshot.id, {
                    onSuccess: () => {
                      toast.success(`Restored “${snapshot.name}”`);
                      onClose();
                      onRestored();
                    },
                    onError: fail,
                  });
                } else {
                  remove.mutate(snapshot.id, {
                    onSuccess: () => {
                      toast.success('Snapshot deleted');
                      onClose();
                    },
                    onError: fail,
                  });
                }
              }}
            >
              {confirm === 'restore' ? 'Restore' : 'Delete'}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            {canDelete && (
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => {
                  setConfirm('delete');
                }}
              >
                Delete
              </Button>
            )}
            {canRestore && (
              <Button
                onClick={() => {
                  setConfirm('restore');
                }}
              >
                Restore
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
