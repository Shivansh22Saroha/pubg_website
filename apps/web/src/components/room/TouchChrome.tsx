'use client';

import type { Board } from '@rotationlab/shared';
import { MessageSquare, Menu, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Fragment, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { UnreadBadge } from './SidePanel';

/**
 * Tablet / phone chrome of the room (UI_UX_SPEC §7): the right panel as a sheet, the chat
 * button that opens it, and the phone's board dropdown, top-bar menu and banner.
 */

/** Tablet: a half-height bottom sheet above the bottom toolbar; the map stays usable. */
export function HalfSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <aside
      aria-label="Room panel"
      data-testid="panel-sheet"
      className="fixed inset-x-0 bottom-14 z-[1200] flex h-[50dvh] flex-col rounded-t-panel border-t bg-surface shadow-panel pointer-coarse:bottom-16"
    >
      <SheetClose onClose={onClose} />
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  );
}

/** Phone: chat (and the other panel tabs) as a full-screen sheet — a dialog, focus trapped. */
export function FullSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="panel-sheet"
          className="fixed inset-0 z-[1500] flex flex-col bg-surface"
          // the chat input focuses itself; don't jump to the close button first
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-2">
            <DialogPrimitive.Title className="px-2 font-display text-lg font-bold">
              Room
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close panel">
                <X className="size-5" aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetClose({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-center">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="flex h-6 w-full items-center justify-center pointer-coarse:h-11"
      >
        <span aria-hidden className="h-1 w-10 rounded-full bg-border" />
      </button>
    </div>
  );
}

/** The chat button of the touch layouts, with the unread count (FEATURES F9). */
export function ChatButton({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="chat-fab"
      aria-label={unread > 0 ? `Open chat, ${unread} unread` : 'Open chat'}
      onClick={onClick}
      className="fixed top-15 right-3 z-[1100] flex size-12 items-center justify-center rounded-full border bg-surface text-text shadow-panel hover:bg-surface-2"
    >
      <MessageSquare className="size-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1" aria-hidden>
          <UnreadBadge count={unread} />
        </span>
      )}
    </button>
  );
}

/** Phone: the board tabs become a dropdown. */
export function BoardSelect({
  boards,
  activeId,
  onSelect,
}: {
  boards: Board[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <NativeSelect
      aria-label="Board"
      data-testid="board-select"
      data-tour="board-tabs"
      className="h-9 min-w-0 flex-1 truncate border-0 bg-transparent px-2 font-display text-base font-bold pointer-coarse:h-11"
      value={activeId ?? ''}
      onChange={(e) => {
        onSelect(e.target.value);
      }}
    >
      {boards.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export interface PhoneMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
}

/** Phone: invite, members, settings, leave… collapsed into one top-bar menu. */
export function PhoneRoomMenu({ items }: { items: PhoneMenuItem[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Room menu"
        data-testid="room-menu"
        data-tour="invite"
        className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-2 hover:text-text"
      >
        <Menu className="size-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <Fragment key={item.label}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              {...(item.destructive ? { destructive: true } : {})}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Phone: the drawing tools are limited — say so, once per visit (dismissible). */
export function PhoneBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    // right padding keeps it clear of the chat button (top-right)
    <div className="pointer-events-none absolute inset-x-0 top-2 z-[1000] flex justify-center pr-16 pl-3">
      <p
        role="note"
        data-testid="phone-banner"
        className={cn(
          'pointer-events-auto flex items-center gap-1 rounded-full border bg-overlay py-1 pr-1 pl-3 text-xs shadow-panel backdrop-blur',
        )}
      >
        Use a larger screen for full drawing tools
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            setOpen(false);
          }}
          className="flex size-11 items-center justify-center rounded-full text-text-muted hover:text-text"
        >
          <X className="size-4" aria-hidden />
        </button>
      </p>
    </div>
  );
}
