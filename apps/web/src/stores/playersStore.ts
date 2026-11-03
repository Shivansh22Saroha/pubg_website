import type { Member } from '@rotationlab/shared';
import { create } from 'zustand';

/** A room member as a linkable player (Phase 12, FEATURES F7). */
export interface Player {
  id: string;
  /** what a linked marker shows: their IGN, else their display name */
  label: string;
  displayName: string;
}

export function playersFrom(members: readonly Member[]): Player[] {
  return members.map((m) => ({
    id: m.user.id,
    label: (m.user.ign ?? '').trim() || m.user.displayName,
    displayName: m.user.displayName,
  }));
}

/** The open room's members as players — fed by the room, read by the map and the style bar. */
export const usePlayersStore = create<{ players: Player[]; byId: Record<string, string> }>(() => ({
  players: [],
  byId: {},
}));

export function setPlayers(members: readonly Member[]) {
  const players = playersFrom(members);
  usePlayersStore.setState({
    players,
    byId: Object.fromEntries(players.map((p) => [p.id, p.label])),
  });
}
