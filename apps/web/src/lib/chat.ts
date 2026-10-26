import {
  gridRef,
  MAPS,
  MessagesResponseSchema,
  type Board,
  type ChatMessage,
  type MessagesResponse,
} from '@rotationlab/shared';
import { api } from './api';

/** GET /rooms/:roomId/messages — newest first, 50 per page (API_SPEC §6). */
export function fetchMessages(roomId: string, before?: string): Promise<MessagesResponse> {
  const q = new URLSearchParams({ limit: '50', ...(before ? { before } : {}) });
  return api(`/rooms/${roomId}/messages?${q.toString()}`, { schema: MessagesResponseSchema });
}

export function deleteMessage(messageId: string): Promise<undefined> {
  return api(`/messages/${messageId}`, { method: 'DELETE' });
}

export interface PingLabel {
  /** `📍 F-M 4,7 · Erangel – Drop A` */
  text: string;
  /** the board is gone: the chip is shown disabled */
  disabled: boolean;
}

/** Chip text for a ping (FEATURES F9): grid reference on that board's map + board name. */
export function pingLabel(
  ping: NonNullable<ChatMessage['ping']>,
  boards: readonly Pick<Board, 'id' | 'name' | 'mapId'>[],
): PingLabel {
  const board = ping.boardId ? boards.find((b) => b.id === ping.boardId) : undefined;
  if (!board) return { text: '📍 board deleted', disabled: true };
  const ref = gridRef([ping.x, ping.y], MAPS[board.mapId].worldSize);
  return { text: `📍 ${ref?.label ?? '?'} · ${board.name}`, disabled: false };
}

/** HH:MM in the viewer's locale. */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
