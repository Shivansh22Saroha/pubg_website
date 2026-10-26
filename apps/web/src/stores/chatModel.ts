import { CHAT_LIMITS, DELETED_BODY, type ChatMessage, type PingInput } from '@rotationlab/shared';

/**
 * Chat state for one room (FEATURES F9) — pure functions over a draft, like `boardModel`.
 * Stored messages are keyed by id and ordered by id (UUIDv7 = creation time). Messages this
 * user is still sending live in `pending`, keyed by clientId, until the ack (or the broadcast,
 * whichever comes first) brings the stored copy.
 */

export interface PendingMessage {
  clientId: string;
  body: string;
  ping: PingInput | null;
  createdAt: string;
  status: 'sending' | 'failed';
  error?: string;
}

export interface ChatState {
  roomId: string | null;
  meId: string;
  byId: Record<string, ChatMessage>;
  /** ascending (oldest first) */
  order: string[];
  pending: PendingMessage[];
  /** cursor for the next older page; null = no more history */
  nextCursor: string | null;
  loaded: boolean;
  /** messages from others that arrived while the chat wasn't visible */
  unread: number;
}

export function emptyChat(roomId: string | null = null, meId = ''): ChatState {
  return {
    roomId,
    meId,
    byId: {},
    order: [],
    pending: [],
    nextCursor: null,
    loaded: false,
    unread: 0,
  };
}

/** Insert / replace stored messages (any order, duplicates fine); settles matching pending. */
export function mergeMessages(s: ChatState, messages: readonly ChatMessage[]) {
  let added = false;
  for (const m of messages) {
    if (m.roomId !== s.roomId) continue;
    if (!(m.id in s.byId)) added = true;
    s.byId[m.id] = m;
    if (m.clientId) s.pending = s.pending.filter((p) => p.clientId !== m.clientId);
  }
  if (added) s.order = Object.keys(s.byId).sort();
}

/** The first page (newest first from the API) or an older page while scrolling up. */
export function loadPage(
  s: ChatState,
  page: { items: readonly ChatMessage[]; nextCursor: string | null },
  older: boolean,
) {
  mergeMessages(s, page.items);
  // a refresh of the latest page (reconnect) must not lose the cursor of older history
  if (older || !s.loaded) s.nextCursor = page.nextCursor;
  s.loaded = true;
}

/**
 * A live `chat:message`. Counts as unread when it is someone else's message and the chat
 * isn't on screen (panel closed or another tab). System messages don't count.
 */
export function receive(s: ChatState, m: ChatMessage, chatVisible: boolean) {
  const isNew = !(m.id in s.byId);
  mergeMessages(s, [m]);
  if (isNew && shouldCountUnread(m, s.meId, chatVisible)) s.unread += 1;
}

export function shouldCountUnread(m: ChatMessage, meId: string, chatVisible: boolean): boolean {
  return !chatVisible && m.kind === 'USER' && m.author?.id !== meId && !m.deleted;
}

export function markDeleted(s: ChatState, messageId: string) {
  const m = s.byId[messageId];
  if (m) s.byId[messageId] = { ...m, deleted: true, body: DELETED_BODY, ping: null };
}

export function addPending(s: ChatState, p: Omit<PendingMessage, 'status'>) {
  s.pending = [...s.pending.filter((x) => x.clientId !== p.clientId), { ...p, status: 'sending' }];
}

export function failPending(s: ChatState, clientId: string, error: string) {
  s.pending = s.pending.map((p) =>
    p.clientId === clientId ? { ...p, status: 'failed', error } : p,
  );
}

export function retryPending(s: ChatState, clientId: string) {
  s.pending = s.pending.map((p) =>
    p.clientId === clientId
      ? {
          clientId: p.clientId,
          body: p.body,
          ping: p.ping,
          createdAt: p.createdAt,
          status: 'sending',
        }
      : p,
  );
}

export function dropPending(s: ChatState, clientId: string) {
  s.pending = s.pending.filter((p) => p.clientId !== clientId);
}

// ---- grouping (UI) -------------------------------------------------------------------------

export type ChatItem =
  { kind: 'message'; message: ChatMessage } | { kind: 'pending'; pending: PendingMessage };

export type ChatGroup =
  | { kind: 'system'; key: string; message: ChatMessage }
  | {
      kind: 'author';
      key: string;
      authorId: string | null;
      author: ChatMessage['author'];
      /** time of the first message of the group */
      at: string;
      items: ChatItem[];
    };

/**
 * Consecutive messages by the same author within 2 min of the previous one form one group
 * (FEATURES F9). System messages stand alone and break groups. Pending messages (mine) come
 * last, grouped with my preceding messages when close enough.
 */
export function groupMessages(
  stored: readonly ChatMessage[],
  pending: readonly PendingMessage[],
  me: ChatMessage['author'],
  windowMs: number = CHAT_LIMITS.groupWindowMs,
): ChatGroup[] {
  const groups: ChatGroup[] = [];
  let last: { authorId: string | null; at: number } | null = null;
  const push = (
    item: ChatItem,
    authorId: string | null,
    author: ChatMessage['author'],
    at: string,
    key: string,
  ) => {
    const t = Date.parse(at);
    const prev = groups.at(-1);
    if (prev?.kind === 'author' && last && last.authorId === authorId && t - last.at <= windowMs) {
      prev.items.push(item);
    } else {
      groups.push({ kind: 'author', key, authorId, author, at, items: [item] });
    }
    last = { authorId, at: t };
  };
  for (const m of stored) {
    if (m.kind === 'SYSTEM') {
      groups.push({ kind: 'system', key: m.id, message: m });
      last = null;
      continue;
    }
    push({ kind: 'message', message: m }, m.author?.id ?? null, m.author, m.createdAt, m.id);
  }
  for (const p of pending)
    push({ kind: 'pending', pending: p }, me?.id ?? null, me, p.createdAt, p.clientId);
  return groups;
}
