import type { ErrorCode } from '@rotationlab/shared';
import type { MicProblem } from '@/stores/voiceStore';

/** RMS (0–1) of a byte time-domain frame from an AnalyserNode (128 = silence) */
export function rmsLevel(frame: Uint8Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (const v of frame) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / frame.length);
}

/** above this RMS a voice counts as speaking (quiet speech ≈ 0.03–0.1, room hiss < 0.01) */
export const SPEAKING_RMS = 0.02;
/** keep the ring on this long after the level drops, so it doesn't flicker between words */
export const SPEAKING_HANGOVER_MS = 300;

/** getUserMedia failure → why the mic can't be used */
export function micProblemOf(err: unknown): MicProblem {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'TypeError') return 'unsupported'; // no mediaDevices (insecure page)
  return 'error';
}

export const MIC_PROBLEM_TEXT: Record<MicProblem, string> = {
  blocked:
    'Microphone blocked — allow it for this site in your browser settings. You can still listen.',
  missing: 'No microphone found. You can still listen.',
  unsupported: 'This browser can’t use a microphone here. You can still listen.',
  error: 'Couldn’t start your microphone. You can still listen.',
};

/** a failed voice:join → what to tell the user */
export function joinErrorText(code: ErrorCode | 'TIMEOUT', message: string): string {
  if (code === 'LIMIT_REACHED') return message; // "Voice is full (8 max)"
  if (code === 'RATE_LIMITED') return 'Too many voice joins — wait a few minutes';
  if (code === 'TIMEOUT') return 'Couldn’t reach the server — check your connection';
  return 'Couldn’t join voice — try again';
}

/** true when a key event should be left to a text field (no shortcuts while typing) */
export function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
