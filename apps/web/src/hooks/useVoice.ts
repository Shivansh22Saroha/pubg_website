'use client';

import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { prefKeys, readPref, writePref } from '@/lib/prefs';
import { typingTarget } from '@/lib/voice/voiceModel';
import { VoiceSession } from '@/lib/voice/voiceSession';
import { useVoiceStore } from '@/stores/voiceStore';

/** push-to-talk key: held to talk (games use ` too; nothing else in the room uses it) */
export const PTT_CODE = 'Backquote';

/**
 * The room's voice session (FEATURES F19): listens for the room's voice roster from the start and
 * is stopped when the room closes. Shortcuts while in voice: Shift+M toggles the mic; in push-to-talk mode, hold `.
 */
export function useVoice(roomId: string, meId: string | undefined) {
  // the object only holds state; start() / stop() below attach it to the socket
  const voice = useMemo(
    () =>
      meId
        ? new VoiceSession(roomId, meId, (message) => {
            toast(message, { id: 'voice' });
          })
        : null,
    [roomId, meId],
  );
  // started in the same commit as the room session, so the voice roster sent on room:join is
  // never missed
  const live = voice;

  useEffect(() => {
    if (!live) return;
    live.start();
    useVoiceStore.setState({ pushToTalk: readPref(prefKeys.voicePushToTalk) === 'true' });
    return () => {
      live.stop();
    };
  }, [live]);

  useEffect(() => {
    const voice = live;
    if (!voice) return;
    const down = (e: KeyboardEvent) => {
      if (useVoiceStore.getState().status !== 'joined' || typingTarget(e.target)) return;
      const { pushToTalk, muted } = useVoiceStore.getState();
      if (pushToTalk && e.code === PTT_CODE) {
        e.preventDefault();
        if (!e.repeat) voice.holdToTalk(true);
      } else if (
        !pushToTalk &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'm'
      ) {
        e.preventDefault();
        voice.setMuted(!muted);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE) voice.holdToTalk(false);
    };
    // releasing the key in another window must not leave the mic open
    const blur = () => {
      voice.holdToTalk(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [live]);

  return live;
}

export function savePushToTalk(voice: VoiceSession, on: boolean) {
  voice.setPushToTalk(on);
  writePref(prefKeys.voicePushToTalk, String(on));
}
