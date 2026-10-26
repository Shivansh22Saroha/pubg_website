import { EventEmitter } from 'node:events';
import type { Board, ChatMessage, Member, RoomDetail, RoomRole } from '@rotationlab/shared';

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
  'board:deleted': [{ roomId: string; boardId: string; name: string }];
  /** a stored chat message (user or system) — realtime broadcasts it to the room */
  'chat:message': [{ roomId: string; message: ChatMessage }];
  'chat:deleted': [{ roomId: string; messageId: string }];
  /** a restore replaced the board's state — clients reload it in full */
  'board:reset': [
    {
      roomId: string;
      boardId: string;
      seq: number;
      reason: 'snapshot_restore' | 'clear';
      actorId: string | null;
    },
  ];
  'snapshot:saved': [{ roomId: string; boardId: string; userId: string; name: string }];
  'snapshot:restored': [{ roomId: string; boardId: string; userId: string; name: string }];
  /** a layer:clear big enough to take an auto snapshot first */
  'layer:cleared': [{ roomId: string; userId: string; layerName: string; count: number }];
}

export type RoomEvents = EventEmitter<RoomEventMap>;

export function createRoomEvents(): RoomEvents {
  return new EventEmitter<RoomEventMap>();
}
