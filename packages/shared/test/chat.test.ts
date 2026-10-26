import { describe, expect, it } from 'vitest';
import {
  CHAT_LIMITS,
  ChatSendSchema,
  MAPS,
  MessagesQuerySchema,
  pingWithinWorld,
  PingInputSchema,
} from '../src/index.js';

/** Chat text and pings (SECURITY V3, FEATURES F9). */

const ROOM = '0192f7a1-0000-7000-8000-000000000001';
const BOARD = '0192f7a1-0000-7000-8000-000000000002';
const CLIENT = '0192f7a1-0000-7000-8000-000000000003';
const send = (body: string, extra: object = {}) =>
  ChatSendSchema.safeParse({ clientId: CLIENT, roomId: ROOM, body, ...extra });

describe('chat body normalization and limits', () => {
  it('trims, NFC-normalises and strips control characters but keeps \\n', () => {
    const r = send('  é\u0000\u0007 go\u001B school\n\trotate\u007F north  ');
    expect(r.success && r.data.body).toBe('é go school\nrotate north');
  });

  it('1–500 code points (emoji count once), after cleaning', () => {
    expect(send('').success).toBe(false);
    expect(send(' \n\u0007 ').success).toBe(false);
    expect(send('x').success).toBe(true);
    expect(send('a'.repeat(CHAT_LIMITS.bodyMax)).success).toBe(true);
    expect(send('a'.repeat(CHAT_LIMITS.bodyMax + 1)).success).toBe(false);
    expect(send('🎯'.repeat(500)).success).toBe(true); // 1 000 UTF-16 units, 500 code points
    expect(send(`  ${'a'.repeat(500)}  `).success).toBe(true); // padding doesn't count
  });

  it('keeps HTML-looking text verbatim — encoding is the renderer’s job', () => {
    const r = send('<img src=x onerror=alert(1)>');
    expect(r.success && r.data.body).toBe('<img src=x onerror=alert(1)>');
  });

  it('rejects unknown keys and a bad clientId', () => {
    expect(send('hi', { extra: 1 }).success).toBe(false);
    expect(ChatSendSchema.safeParse({ clientId: 'nope', roomId: ROOM, body: 'hi' }).success).toBe(
      false,
    );
  });
});

describe('ping validation', () => {
  it('shape: integer coordinates ≥ 0 within the absolute cap, a uuid board', () => {
    expect(PingInputSchema.safeParse({ boardId: BOARD, x: 0, y: 816_000 }).success).toBe(true);
    expect(PingInputSchema.safeParse({ boardId: BOARD, x: -1, y: 0 }).success).toBe(false);
    expect(PingInputSchema.safeParse({ boardId: BOARD, x: 1.5, y: 0 }).success).toBe(false);
    expect(PingInputSchema.safeParse({ boardId: BOARD, x: 1_000_001, y: 0 }).success).toBe(false);
    expect(PingInputSchema.safeParse({ boardId: 'b', x: 1, y: 1 }).success).toBe(false);
    expect(send('hi', { ping: { boardId: BOARD, x: 1, y: 1 } }).success).toBe(true);
  });

  it('bounds: inside that board’s map, edges included (checked server-side per map)', () => {
    const W = MAPS.erangel.worldSize;
    expect(pingWithinWorld({ x: 0, y: 0 }, W)).toBe(true);
    expect(pingWithinWorld({ x: W, y: W }, W)).toBe(true);
    expect(pingWithinWorld({ x: W + 1, y: 0 }, W)).toBe(false);
    expect(pingWithinWorld({ x: 0, y: W + 1 }, W)).toBe(false);
  });
});

describe('history query', () => {
  it('defaults to 50, allows up to 100, cursor must be a uuid', () => {
    expect(MessagesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(MessagesQuerySchema.parse({ limit: '100' })).toEqual({ limit: 100 });
    expect(MessagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(MessagesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(MessagesQuerySchema.safeParse({ before: 'x' }).success).toBe(false);
  });
});
