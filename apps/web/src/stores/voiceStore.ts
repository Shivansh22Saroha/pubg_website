import type { VoicePeer } from '@rotationlab/shared';
import { create } from 'zustand';

export type VoiceStatus = 'idle' | 'joining' | 'joined';
/** why this user can't talk (they can still listen) */
export type MicProblem = 'blocked' | 'missing' | 'unsupported' | 'error';
export type LinkState = 'connecting' | 'connected' | 'failed';

export interface VoiceState {
  roomId: string | null;
  /** everyone in the room's voice channel (me included once joined) — from the server */
  peers: VoicePeer[];
  status: VoiceStatus;
  myPeerId: string | null;
  /** my mic is off (in push-to-talk mode: not holding the key) */
  muted: boolean;
  /** I hear nobody (and my mic is off) */
  deafened: boolean;
  pushToTalk: boolean;
  mic: MicProblem | null;
  /** media connection to each other peer */
  links: Record<string, LinkState>;
  /** userIds whose audio is above the speaking threshold right now */
  speaking: Record<string, true>;
}

const initial: Omit<VoiceState, 'pushToTalk'> = {
  roomId: null,
  peers: [],
  status: 'idle',
  myPeerId: null,
  muted: true,
  deafened: false,
  mic: null,
  links: {},
  speaking: {},
};

/** Room voice chat (FEATURES F19): what the UI shows. VoiceSession writes it. */
export const useVoiceStore = create<VoiceState>()(() => ({ ...initial, pushToTalk: false }));

export function resetVoice(roomId: string | null) {
  useVoiceStore.setState((s) => ({ ...initial, roomId, pushToTalk: s.pushToTalk }));
}

/** a shallow-equal-safe update of one map entry */
export function setLink(peerId: string, state: LinkState | null) {
  useVoiceStore.setState((s) => {
    if ((s.links[peerId] ?? null) === state) return s;
    const rest = Object.fromEntries(Object.entries(s.links).filter(([k]) => k !== peerId));
    return { links: state ? { ...rest, [peerId]: state } : rest };
  });
}

export function setSpeaking(userId: string, on: boolean) {
  useVoiceStore.setState((s) => {
    if (Boolean(s.speaking[userId]) === on) return s;
    const rest = Object.fromEntries(
      Object.entries(s.speaking).filter(([k]) => k !== userId),
    ) as Record<string, true>;
    return { speaking: on ? { ...rest, [userId]: true as const } : rest };
  });
}
