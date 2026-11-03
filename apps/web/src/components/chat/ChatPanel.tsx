'use client';

import {
  CHAT_LIMITS,
  can,
  codePointLength,
  type Board,
  type ChatMessage,
  type Member,
  type RoomRole,
} from '@rotationlab/shared';
import { ArrowDown, EllipsisVertical, MapPin, RotateCw, Send, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Avatar } from '@/components/auth/UserMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api';
import { deleteMessage, fetchMessages, pingLabel, shortTime } from '@/lib/chat';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { cn } from '@/lib/utils';
import { groupMessages, type ChatGroup, type ChatItem } from '@/stores/chatModel';
import { useChatStore } from '@/stores/chatStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { typingLabel } from '@/stores/typingModel';
import { useTypingStore } from '@/stores/typingStore';
import { selectChatVisible, useWorkspaceStore } from '@/stores/workspaceStore';

/** a scrolled-up list is "at the bottom" within this many px */
const BOTTOM_SLACK_PX = 48;
/** aria-live announcements at most this often (UI_UX_SPEC §10) */
const ANNOUNCE_MS = 3_000;

/**
 * Chat tab (UI_UX_SPEC §3.5, FEATURES F9). Everything user-written is a React text node —
 * no HTML, no auto-linking (SECURITY V4/V6). Optimistic sends show as pending until the ack.
 */
export function ChatPanel({
  roomId,
  meId,
  role,
  members,
  boards,
  session,
}: {
  roomId: string;
  meId: string;
  role: RoomRole;
  members: Member[];
  boards: Board[];
  session: RoomSession | null;
}) {
  const order = useChatStore((s) => s.order);
  const byId = useChatStore((s) => s.byId);
  const pending = useChatStore((s) => s.pending);
  const nextCursor = useChatStore((s) => s.nextCursor);
  const loaded = useChatStore((s) => s.loaded);
  const visible = useWorkspaceStore(selectChatVisible);
  const me = members.find((m) => m.user.id === meId)?.user ?? null;

  const stored = useMemo(
    () => order.map((id) => byId[id]).filter((m): m is ChatMessage => m !== undefined),
    [order, byId],
  );
  const groups = useMemo(() => groupMessages(stored, pending, me), [stored, pending, me]);

  // ---- scrolling: stick to the bottom, keep position when older pages load ---------------
  const list = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const restore = useRef<number | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const lastId = stored.at(-1)?.id;
  const lastCount = useRef(stored.length + pending.length);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop += el.scrollHeight - restore.current; // older page prepended
      restore.current = null;
      return;
    }
    const count = stored.length + pending.length;
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (atBottom.current || !grew) el.scrollTop = el.scrollHeight;
    else setNewBelow((n) => n + 1);
  }, [lastId, stored.length, pending.length]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
    if (atBottom.current) setNewBelow(0);
  };

  const jumpToLatest = () => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setNewBelow(0);
  };

  // infinite scroll upwards
  const loadingOlder = useRef(false);
  useEffect(() => {
    const sentinel = top.current;
    if (!sentinel || !nextCursor) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || loadingOlder.current) return;
      loadingOlder.current = true;
      restore.current = list.current?.scrollHeight ?? null;
      fetchMessages(roomId, nextCursor)
        .then((page) => {
          useChatStore.getState().pageLoaded(page, true);
        })
        .catch(() => {
          restore.current = null;
        })
        .finally(() => {
          loadingOlder.current = false;
        });
    });
    io.observe(sentinel);
    return () => {
      io.disconnect();
    };
  }, [roomId, nextCursor]);

  // reading the chat clears the unread badge
  useEffect(() => {
    if (visible) useChatStore.getState().markRead();
  }, [visible, lastId]);

  // throttled screen-reader announcement of new messages from others
  const [announce, setAnnounce] = useState('');
  const announced = useRef<{ at: number; id: string | undefined }>({ at: 0, id: lastId });
  useEffect(() => {
    const last = stored.at(-1);
    if (!last || last.id === announced.current.id) return;
    const fire = () => {
      announced.current = { at: Date.now(), id: last.id };
      if (last.author?.id !== meId)
        setAnnounce(
          last.kind === 'SYSTEM'
            ? last.body
            : `${last.author?.displayName ?? 'Someone'}: ${last.body}`,
        );
    };
    const wait = announced.current.at + ANNOUNCE_MS - Date.now();
    if (wait <= 0) {
      fire();
      return;
    }
    const t = setTimeout(fire, wait);
    return () => {
      clearTimeout(t);
    };
  }, [stored, meId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={list}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2"
        data-testid="chat-list"
      >
        <div ref={top} aria-hidden className="h-1" />
        {loaded && !nextCursor && (
          <p className="py-2 text-center text-xs text-text-muted">Start of the room chat</p>
        )}
        {!loaded && <p className="py-4 text-center text-sm text-text-muted">Loading chat…</p>}
        <ol aria-label="Messages" className="flex flex-col gap-2">
          {groups.map((g) => (
            <Group
              key={g.key}
              group={g}
              meId={meId}
              role={role}
              boards={boards}
              session={session}
            />
          ))}
        </ol>
      </div>
      <p className="sr-only" aria-live="polite" data-testid="chat-live">
        {announce}
      </p>
      {newBelow > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={jumpToLatest}
            data-testid="jump-latest"
            className="absolute -top-10 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg shadow-panel"
          >
            <ArrowDown className="size-3" aria-hidden /> Jump to latest
          </button>
        </div>
      )}
      <TypingIndicator members={members} />
      {/* keyed by room: a half-written message doesn't follow you into another room */}
      <Composer key={roomId} boards={boards} session={session} />
    </div>
  );
}

function Group({
  group,
  meId,
  role,
  boards,
  session,
}: {
  group: ChatGroup;
  meId: string;
  role: RoomRole;
  boards: Board[];
  session: RoomSession | null;
}) {
  const users = usePresenceStore((s) => s.users);
  if (group.kind === 'system') {
    return (
      <li className="py-1 text-center text-xs text-text-muted" data-testid="chat-system">
        {group.message.body} · {shortTime(group.message.createdAt)}
      </li>
    );
  }
  const author = group.author;
  const color = group.authorId ? users[group.authorId]?.color : undefined;
  return (
    <li className="flex gap-2" data-testid="chat-group">
      {author ? (
        <Avatar user={author} className="mt-0.5 size-7 shrink-0 text-xs" />
      ) : (
        <span className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-2" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-sm">
          <span
            className={cn('font-semibold', !color && 'text-text-muted')}
            // presence colours come from the server's fixed palette
            style={color ? { color } : undefined}
          >
            {author?.displayName ?? 'Former member'}
          </span>
          <time className="text-xs text-text-muted" dateTime={group.at}>
            {shortTime(group.at)}
          </time>
        </p>
        <ul className="flex flex-col gap-0.5">
          {group.items.map((item) => (
            <Line
              key={item.kind === 'message' ? item.message.id : item.pending.clientId}
              item={item}
              canDelete={
                item.kind === 'message' &&
                !item.message.deleted &&
                (item.message.author?.id === meId || can(role, 'chat.deleteAny'))
              }
              boards={boards}
              session={session}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}

function Line({
  item,
  canDelete,
  boards,
  session,
}: {
  item: ChatItem;
  canDelete: boolean;
  boards: Board[];
  session: RoomSession | null;
}) {
  const requestFocus = useWorkspaceStore((s) => s.requestFocus);
  if (item.kind === 'pending') {
    const p = item.pending;
    return (
      <li data-testid="chat-pending" data-status={p.status} className="text-sm">
        <span className="whitespace-pre-wrap break-words opacity-60">{p.body}</span>
        {p.ping && <PingChip ping={p.ping} boards={boards} onOpen={undefined} />}
        {p.status === 'sending' ? (
          <span className="ml-2 text-xs text-text-muted">Sending…</span>
        ) : (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-danger">
            {p.error ?? 'Not sent'}
            <button
              type="button"
              className="inline-flex items-center gap-0.5 underline"
              onClick={() => {
                session?.retryChat(p.clientId);
              }}
            >
              <RotateCw className="size-3" aria-hidden /> Retry
            </button>
            <button
              type="button"
              aria-label="Discard message"
              onClick={() => {
                useChatStore.getState().drop(p.clientId);
              }}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )}
      </li>
    );
  }
  const m = item.message;
  return (
    <li className="group relative pr-6 text-sm" data-testid="chat-message" data-id={m.id}>
      {m.deleted ? (
        <span className="italic text-text-muted">{m.body}</span>
      ) : (
        <span className="whitespace-pre-wrap break-words" data-testid="chat-body">
          {m.body}
        </span>
      )}
      {m.ping && !m.deleted && (
        <PingChip
          ping={m.ping}
          boards={boards}
          onOpen={(boardId) => {
            if (m.ping) requestFocus({ boardId, x: m.ping.x, y: m.ping.y });
          }}
        />
      )}
      {canDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Message options"
            // touch has no hover: always shown there, with a 44 px target (UI_UX_SPEC §7)
            className="absolute top-0 right-0 rounded-control p-0.5 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:-top-2 pointer-coarse:-right-2 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:opacity-100"
          >
            <EllipsisVertical className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              destructive
              onSelect={() => {
                deleteMessage(m.id).then(
                  () => {
                    useChatStore.getState().deleted(m.id);
                  },
                  (err: unknown) => {
                    toast.error(err instanceof ApiError ? err.message : 'Could not delete');
                  },
                );
              }}
            >
              Delete message
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function PingChip({
  ping,
  boards,
  onOpen,
}: {
  ping: { boardId: string | null; x: number; y: number };
  boards: Board[];
  /** undefined → not clickable (a pending message) */
  onOpen: ((boardId: string) => void) | undefined;
}) {
  const label = pingLabel(ping, boards);
  const disabled = label.disabled || !onOpen;
  return (
    <button
      type="button"
      data-testid="ping-chip"
      disabled={disabled}
      title={label.disabled ? 'That board was deleted' : 'Show on the map'}
      onClick={() => {
        if (ping.boardId && onOpen) onOpen(ping.boardId);
      }}
      className={cn(
        'mt-1 flex w-fit items-center rounded-full border px-2 py-0.5 font-mono text-xs',
        disabled ? 'cursor-default opacity-50' : 'hover:border-accent hover:text-accent',
      )}
    >
      {label.text}
    </button>
  );
}

/**
 * Phase 11 (FEATURES F9): "X is typing…" above the input, from volatile `chat:typing` events;
 * a name drops 4 s after its last event or as soon as their message arrives. Not a live region
 * (it would chatter); the message itself is announced.
 */
function TypingIndicator({ members }: { members: Member[] }) {
  const typing = useTypingStore((s) => s.typing);
  const active = Object.keys(typing).length > 0;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      useTypingStore.getState().prune();
    }, 500);
    return () => {
      clearInterval(t);
    };
  }, [active]);
  const names = Object.keys(typing).map(
    (id) => members.find((m) => m.user.id === id)?.user.displayName ?? 'Someone',
  );
  return (
    <p data-testid="typing-indicator" className="h-5 truncate px-3 text-xs text-text-muted italic">
      {typingLabel(names)}
    </p>
  );
}

function Composer({ boards, session }: { boards: Board[]; session: RoomSession | null }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const draftPing = useWorkspaceStore((s) => s.draftPing);
  const pingPick = useWorkspaceStore((s) => s.pingPick);
  const chatFocus = useWorkspaceStore((s) => s.chatFocus);
  const length = codePointLength(text.trim());
  const tooLong = length > CHAT_LIMITS.bodyMax;

  useEffect(() => {
    if (chatFocus > 0) input.current?.focus();
  }, [chatFocus]);

  const send = () => {
    const body = text.trim();
    if (!body || tooLong || !session) return;
    session.sendChat(body, draftPing);
    setText('');
    useWorkspaceStore.getState().clearPing();
  };

  return (
    <form
      method="post"
      className="flex flex-col gap-1 border-t p-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {draftPing && (
        <span
          className="flex w-fit items-center gap-1 rounded-full border border-accent px-2 py-0.5 font-mono text-xs text-accent"
          data-testid="draft-ping"
        >
          {pingLabel(draftPing, boards).text}
          <button
            type="button"
            aria-label="Remove ping"
            onClick={() => {
              useWorkspaceStore.getState().clearPing();
            }}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
      <div className="flex items-end gap-1">
        <textarea
          ref={input}
          data-chat-input=""
          aria-label="Message"
          rows={1}
          value={text}
          placeholder="Message the room…"
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) session?.sendTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          className="max-h-28 min-h-9 flex-1 resize-none rounded-control border bg-bg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent [field-sizing:content]"
        />
        <button
          type="button"
          aria-label="Attach a map ping"
          aria-pressed={pingPick}
          title="Ping a spot on the map (or Alt+click the map)"
          data-testid="ping-button"
          onClick={() => {
            useWorkspaceStore.getState().setPingPick(!pingPick);
          }}
          className={cn(
            'flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-surface-2 hover:text-text',
            pingPick && 'bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg',
          )}
        >
          <MapPin className="size-4" aria-hidden />
        </button>
        <button
          type="submit"
          aria-label="Send"
          disabled={length === 0 || tooLong}
          className="flex size-9 items-center justify-center rounded-control bg-accent text-accent-fg disabled:opacity-40"
        >
          <Send className="size-4" aria-hidden />
        </button>
      </div>
      {length > CHAT_LIMITS.counterFrom && (
        <p
          className={cn(
            'text-right font-mono text-xs',
            tooLong ? 'text-danger' : 'text-text-muted',
          )}
          data-testid="chat-counter"
        >
          {length}/{CHAT_LIMITS.bodyMax}
        </p>
      )}
    </form>
  );
}
