import { afterEach, describe, expect, it } from 'vitest';
import {
  joinErrorText,
  micProblemOf,
  rmsLevel,
  SPEAKING_RMS,
  typingTarget,
} from '@/lib/voice/voiceModel';
import { resetVoice, setLink, setSpeaking, useVoiceStore } from '@/stores/voiceStore';

describe('voice model', () => {
  it('measures loudness from an analyser frame', () => {
    expect(rmsLevel(new Uint8Array(512).fill(128))).toBe(0);
    const tone = Uint8Array.from({ length: 512 }, (_, i) => 128 + Math.round(40 * Math.sin(i / 4)));
    expect(rmsLevel(tone)).toBeGreaterThan(SPEAKING_RMS);
    const hiss = Uint8Array.from({ length: 512 }, (_, i) => 128 + (i % 2));
    expect(rmsLevel(hiss)).toBeLessThan(SPEAKING_RMS);
    expect(rmsLevel(new Uint8Array(0))).toBe(0);
  });

  it('explains why the mic cannot be used', () => {
    expect(micProblemOf(new DOMException('x', 'NotAllowedError'))).toBe('blocked');
    expect(micProblemOf(new DOMException('x', 'NotFoundError'))).toBe('missing');
    expect(micProblemOf(new TypeError('no mediaDevices'))).toBe('unsupported');
    expect(micProblemOf(new DOMException('x', 'NotReadableError'))).toBe('error');
    expect(micProblemOf('weird')).toBe('error');
  });

  it('turns join failures into plain words', () => {
    expect(joinErrorText('LIMIT_REACHED', 'Voice is full (8 max)')).toBe('Voice is full (8 max)');
    expect(joinErrorText('TIMEOUT', '')).toMatch(/connection/);
    expect(joinErrorText('RATE_LIMITED', '')).toMatch(/wait/);
    expect(joinErrorText('INTERNAL', 'stack trace')).toBe('Couldn’t join voice — try again');
  });

  it('never steals keys from text fields', () => {
    expect(typingTarget(document.createElement('input'))).toBe(true);
    expect(typingTarget(document.createElement('textarea'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true'); // jsdom has no contentEditable setter
    document.body.appendChild(div);
    expect(typingTarget(div)).toBe(true);
    expect(typingTarget(document.createElement('button'))).toBe(false);
    expect(typingTarget(null)).toBe(false);
    div.remove();
  });
});

describe('voice store', () => {
  afterEach(() => {
    resetVoice(null);
    useVoiceStore.setState({ pushToTalk: false });
  });

  it('updates link and speaking maps without churn', () => {
    setLink('p1', 'connecting');
    const before = useVoiceStore.getState().links;
    setLink('p1', 'connecting');
    expect(useVoiceStore.getState().links).toBe(before); // no change → same object
    setLink('p1', 'connected');
    setLink('p2', 'failed');
    expect(useVoiceStore.getState().links).toEqual({ p1: 'connected', p2: 'failed' });
    setLink('p1', null);
    expect(useVoiceStore.getState().links).toEqual({ p2: 'failed' });

    setSpeaking('u1', true);
    const s = useVoiceStore.getState().speaking;
    setSpeaking('u1', true);
    expect(useVoiceStore.getState().speaking).toBe(s);
    setSpeaking('u1', false);
    expect(useVoiceStore.getState().speaking).toEqual({});
  });

  it('reset keeps the push-to-talk preference', () => {
    useVoiceStore.setState({ pushToTalk: true, status: 'joined', muted: false });
    resetVoice('room');
    expect(useVoiceStore.getState()).toMatchObject({
      roomId: 'room',
      status: 'idle',
      muted: true,
      pushToTalk: true,
    });
  });
});
