import { z } from 'zod';
import { textField } from '../text.js';
import { PublicUserSchema } from './auth.js';
import { ELEMENT_LIMITS } from './elements.js';

/** Chat & map pings (FEATURES F9, API_SPEC §6–7, DATABASE_SCHEMA §3.12). */
export const CHAT_LIMITS = {
  bodyMax: 500,
  /** the client shows a counter from here on (UI_UX_SPEC §3.5) */
  counterFrom: 400,
  pageDefault: 50,
  pageMax: 100,
  /** consecutive messages by one author within this window form a group */
  groupWindowMs: 2 * 60 * 1000,
} as const;

/** What a deleted message's body becomes (the original text is overwritten, not kept). */
export const DELETED_BODY = 'message deleted';

/** User text: trimmed, NFC, control characters stripped except `\n`, 1–500 code points. */
export const ChatBodySchema = textField(1, CHAT_LIMITS.bodyMax, { keepNewlines: true });

const Coord = z.number().int().min(0).max(ELEMENT_LIMITS.maxCoord);

/** A ping as sent: board of this room, point inside that board's map (checked server-side). */
export const PingInputSchema = z.strictObject({ boardId: z.uuid(), x: Coord, y: Coord });
export type PingInput = z.output<typeof PingInputSchema>;

/** Inside 0…worldSize of the ping's board (the shape check alone allows the absolute cap). */
export function pingWithinWorld(ping: { x: number; y: number }, worldSize: number): boolean {
  return ping.x >= 0 && ping.y >= 0 && ping.x <= worldSize && ping.y <= worldSize;
}

export const ChatMessageSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  author: PublicUserSchema.nullable(),
  kind: z.enum(['USER', 'SYSTEM']),
  body: z.string(),
  /** `boardId` becomes null when that board is deleted (the chip then shows disabled) */
  ping: z
    .object({ boardId: z.uuid().nullable(), x: z.number().int(), y: z.number().int() })
    .nullable(),
  deleted: z.boolean(),
  /** the sender's idempotency key (matches an optimistic message); null for system messages */
  clientId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const MessagesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(CHAT_LIMITS.pageMax).default(CHAT_LIMITS.pageDefault),
  /** cursor: an id from the previous page — returns older messages */
  before: z.uuid().optional(),
});
export const MessagesResponseSchema = z.object({
  items: z.array(ChatMessageSchema),
  nextCursor: z.uuid().nullable(),
});
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;
export const MessageParamsSchema = z.strictObject({ messageId: z.uuid() });
