import { z } from 'zod';

/**
 * Room voice chat (FEATURES F19): a peer-to-peer WebRTC mesh signalled over the room socket.
 * Every pair connects directly (or through the TURN relay when a network blocks that), so the
 * channel is capped — each speaker sends one audio stream per listener.
 */
export const VOICE_MAX_PEERS = 8;

/** A voice participant is one socket (one tab), never more than one per user per room. */
export const VoicePeerSchema = z.object({
  /** the socket id: what signals are addressed to */
  peerId: z.string().min(1).max(64),
  userId: z.uuid(),
  muted: z.boolean(),
});
export type VoicePeer = z.infer<typeof VoicePeerSchema>;

/** RTCIceServer, as handed to `new RTCPeerConnection({ iceServers })` */
export const IceServerSchema = z.object({
  urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof IceServerSchema>;

export const VoiceJoinSchema = z.strictObject({ roomId: z.uuid() });
export const VoiceLeaveSchema = VoiceJoinSchema;
export const VoiceMuteSchema = z.strictObject({ roomId: z.uuid(), muted: z.boolean() });

/** an SDP blob (an Opus-only audio offer is ~2–4 KB; generous headroom, still bounded) */
const Sdp = z.string().min(1).max(16_000);

export const VoiceSignalDataSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('offer'), sdp: Sdp }),
  z.strictObject({ type: z.literal('answer'), sdp: Sdp }),
  z.strictObject({
    type: z.literal('ice'),
    candidate: z.strictObject({
      candidate: z.string().max(1_000),
      sdpMid: z.string().max(64).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }),
  }),
]);
export type VoiceSignalData = z.infer<typeof VoiceSignalDataSchema>;

/** relayed to `to` only, and only while both sockets are in that room's voice channel */
export const VoiceSignalSchema = z.strictObject({
  roomId: z.uuid(),
  to: z.string().min(1).max(64),
  data: VoiceSignalDataSchema,
});

export const VoiceJoinAckSchema = z.object({
  /** this socket's peer id (its socket id) */
  peerId: z.string(),
  peers: z.array(VoicePeerSchema),
  iceServers: z.array(IceServerSchema),
});
export type VoiceJoinAck = z.infer<typeof VoiceJoinAckSchema>;

/**
 * Glare-free negotiation: of each pair, the peer with the smaller id sends the offer (and
 * restarts ICE after a failure). Both sides know both ids, so nobody waits on the other.
 */
export function isOfferer(myPeerId: string, otherPeerId: string): boolean {
  return myPeerId < otherPeerId;
}
