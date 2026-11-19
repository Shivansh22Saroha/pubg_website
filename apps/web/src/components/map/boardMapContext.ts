'use client';

import { createContext, useContext } from 'react';
import type { BoardMapInfo } from '@/lib/boardMap';

/** the map of the board on screen (FEATURES F20) — provided by MapCanvas */
export const BoardMapContext = createContext<BoardMapInfo | null>(null);

/** metres per world unit of the board on screen (0.01 on PUBG maps) */
export function useMetresPerUnit(): number {
  return useContext(BoardMapContext)?.metresPerUnit ?? 0.01;
}

export function useBoardMapInfo(): BoardMapInfo | null {
  return useContext(BoardMapContext);
}
