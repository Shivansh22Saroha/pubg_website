import { describe, expect, it } from 'vitest';
import { isOfferer, VOICE_MAX_PEERS, VoiceJoinAckSchema, VoiceSignalSchema } from '../src/voice.js';

const roomId = '0190a0a0-0000-7000-8000-000000000001';

describe('voice contract', () => {
  it('caps the mesh at 8', () => {
    expect(VOICE_MAX_PEERS).toBe(8);
  });

  it('accepts offers, answers and ICE candidates', () => {
    for (const data of [
      { type: 'offer', sdp: 'v=0' },
      { type: 'answer', sdp: 'v=0' },
      {
        type: 'ice',
        candidate: {
          candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
      { type: 'ice', candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null } },
    ]) {
      expect(VoiceSignalSchema.safeParse({ roomId, to: 'abc', data }).success).toBe(true);
    }
  });

  it('rejects oversized, unknown or extra fields', () => {
    const bad = [
      { roomId, to: 'abc', data: { type: 'offer', sdp: 'x'.repeat(16_001) } },
      { roomId, to: 'abc', data: { type: 'bye' } },
      { roomId, to: 'abc', data: { type: 'offer', sdp: 'v=0', extra: 1 } },
      { roomId, to: '', data: { type: 'offer', sdp: 'v=0' } },
      { roomId, to: 'x'.repeat(65), data: { type: 'offer', sdp: 'v=0' } },
      { roomId: 'nope', to: 'abc', data: { type: 'offer', sdp: 'v=0' } },
      { roomId, to: 'abc', data: { type: 'ice', candidate: { candidate: 'x'.repeat(1_001) } } },
    ];
    for (const p of bad) expect(VoiceSignalSchema.safeParse(p).success).toBe(false);
  });

  it('parses a join ack with TURN credentials', () => {
    const ack = VoiceJoinAckSchema.parse({
      peerId: 's1',
      peers: [{ peerId: 's2', userId: roomId, muted: true }],
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: 'turn:turn.cloudflare.com:3478', username: 'u', credential: 'c' },
      ],
    });
    expect(ack.peers).toHaveLength(1);
  });

  it('picks exactly one offerer per pair', () => {
    expect(isOfferer('a', 'b')).toBe(true);
    expect(isOfferer('b', 'a')).toBe(false);
    expect(isOfferer('a', 'a')).toBe(false);
  });
});
