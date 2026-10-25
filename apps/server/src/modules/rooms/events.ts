import { EventEmitter } from 'node:events';
import type { Board, Member, RoomDetail, RoomRole } from '@rotationlab/shared';

/**
 * Domain events raised by REST mutations that affect live users (ARCHITECTURE §8). Phase 5's
 * Socket.IO layer subscribes and broadcasts them (`member:kicked`, `board:created`, …) and
 * force-disconnects kicked users (SECURITY Z5).
 */
export interface RoomEventMap {
  'member:joined': [{ roomId: string; member: Member }];
  'member:left': [{ roomId: string; userId: string }];
  'member:kicked': [{ roomId: string; userId: string }];
  'member:roleChanged': [{ roomId: string; userId: string; role: RoomRole }];
  'room:updated': [{ roomId: string; room: RoomDetail }];
  'room:deleted': [{ roomId: string }];
  'board:created': [{ roomId: string; board: Board }];
  'board:updated': [{ roomId: string; board: Board }];
  'board:deleted': [{ roomId: string; boardId: string }];
}

export type RoomEvents = EventEmitter<RoomEventMap>;

export function createRoomEvents(): RoomEvents {
  return new EventEmitter<RoomEventMap>();
}
