'use client';

import { VOICE_MAX_PEERS, type Member } from '@rotationlab/shared';
import {
  AlertTriangle,
  Headphones,
  HeadphoneOff,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Users,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Avatar } from '@/components/auth/UserMenu';
import { Hint } from '@/components/ui/hint';
import { savePushToTalk } from '@/hooks/useVoice';
import { cn } from '@/lib/utils';
import { MIC_PROBLEM_TEXT } from '@/lib/voice/voiceModel';
import type { VoiceSession } from '@/lib/voice/voiceSession';
import { useVoiceStore } from '@/stores/voiceStore';

const iconButton =
  'flex size-8 shrink-0 items-center justify-center rounded-control text-text transition-colors duration-150 ease-hud hover:bg-surface-2 disabled:opacity-50 pointer-coarse:size-11';

/**
 * Voice chat controls (FEATURES F19, UI_UX_SPEC §3.5). Not in voice: a "Voice" button with how
 * many teammates are talking already. In voice: mic, deafen, the people in voice (speaking
 * rings, mute and connection state, push-to-talk setting) and leave. `dock` is the floating
 * phone version; `header` sits in the room's top bar.
 */
export function VoiceControls({
  voice,
  members,
  variant,
}: {
  voice: VoiceSession | null;
  members: Member[];
  variant: 'header' | 'dock';
}) {
  const status = useVoiceStore((s) => s.status);
  const peers = useVoiceStore((s) => s.peers);
  const count = peers.length;
  const full = count >= VOICE_MAX_PEERS;

  if (status !== 'joined') {
    if (variant === 'dock') return null; // phones join from the room menu
    const joining = status === 'joining';
    return (
      <Hint
        label="Voice"
        description={
          full ? `Voice is full (${VOICE_MAX_PEERS} max)` : 'Talk with teammates in this room'
        }
        side="bottom"
      >
        <button
          type="button"
          data-testid="voice-join"
          aria-label={count > 0 ? `Join voice, ${count} in voice` : 'Join voice'}
          disabled={!voice || joining || full}
          onClick={() => void voice?.join()}
          className="flex h-8 items-center gap-1.5 rounded-control border border-border px-2.5 text-[13px] font-semibold text-text transition-colors hover:border-accent hover:text-accent disabled:opacity-60 disabled:hover:border-border disabled:hover:text-text pointer-coarse:h-11"
        >
          {joining ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Headphones className="size-4" aria-hidden />
          )}
          Voice
          {count > 0 && (
            <span className="rounded-full bg-success/20 px-1.5 text-[11px] text-success">
              {count}
            </span>
          )}
        </button>
      </Hint>
    );
  }

  return (
    <div
      role="group"
      aria-label="Voice chat"
      data-testid={variant === 'dock' ? 'voice-dock' : 'voice-controls'}
      className={cn(
        'flex items-center gap-0.5',
        variant === 'header' && 'rounded-control border border-success/50 bg-success/10 p-0.5',
        variant === 'dock' && 'glass rounded-panel p-1 shadow-panel',
      )}
    >
      <MicButton voice={voice} />
      <DeafenButton voice={voice} />
      <People voice={voice} members={members} compact={variant === 'dock'} />
      <Hint label="Leave voice" side="bottom">
        <button
          type="button"
          aria-label="Leave voice"
          data-testid="voice-leave"
          onClick={() => void voice?.leave()}
          className={cn(iconButton, 'text-danger hover:bg-danger/15')}
        >
          <PhoneOff className="size-4" aria-hidden />
        </button>
      </Hint>
    </div>
  );
}

function MicButton({ voice }: { voice: VoiceSession | null }) {
  const muted = useVoiceStore((s) => s.muted);
  const ptt = useVoiceStore((s) => s.pushToTalk);
  const mic = useVoiceStore((s) => s.mic);
  const deafened = useVoiceStore((s) => s.deafened);
  const live = !mic && !muted && !deafened;
  const label = mic ? 'No microphone' : ptt ? 'Hold to talk' : muted ? 'Unmute' : 'Mute';
  const description = mic
    ? MIC_PROBLEM_TEXT[mic]
    : ptt
      ? 'Hold this button, or hold the ` key'
      : `${muted ? 'Turn your mic on' : 'Turn your mic off'} (Shift+M)`;
  // push-to-talk on touch and mouse: press and hold the button itself
  const hold = (held: boolean) => (e: ReactPointerEvent) => {
    if (!ptt) return;
    e.preventDefault();
    voice?.holdToTalk(held);
  };
  return (
    <Hint label={label} description={description} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={ptt ? undefined : !muted}
        data-testid="voice-mic"
        data-live={live}
        disabled={Boolean(mic)}
        onClick={() => {
          if (!ptt) voice?.setMuted(!muted);
        }}
        onPointerDown={hold(true)}
        onPointerUp={hold(false)}
        onPointerCancel={hold(false)}
        onPointerLeave={hold(false)}
        onContextMenu={(e) => {
          if (ptt) e.preventDefault(); // a long press must not open the menu
        }}
        className={cn(
          iconButton,
          'touch-none select-none',
          live ? 'bg-success text-bg hover:bg-success/90' : 'text-danger hover:bg-danger/15',
        )}
      >
        {live ? <Mic className="size-4" aria-hidden /> : <MicOff className="size-4" aria-hidden />}
      </button>
    </Hint>
  );
}

function DeafenButton({ voice }: { voice: VoiceSession | null }) {
  const deafened = useVoiceStore((s) => s.deafened);
  return (
    <Hint
      label={deafened ? 'Undeafen' : 'Deafen'}
      description={deafened ? 'Hear the others again' : 'Mute everyone for you (and your mic)'}
      side="bottom"
    >
      <button
        type="button"
        aria-label={deafened ? 'Undeafen' : 'Deafen'}
        aria-pressed={deafened}
        data-testid="voice-deafen"
        onClick={() => {
          voice?.setDeafened(!deafened);
        }}
        className={cn(iconButton, deafened && 'text-danger hover:bg-danger/15')}
      >
        {deafened ? (
          <HeadphoneOff className="size-4" aria-hidden />
        ) : (
          <Headphones className="size-4" aria-hidden />
        )}
      </button>
    </Hint>
  );
}

function People({
  voice,
  members,
  compact,
}: {
  voice: VoiceSession | null;
  members: Member[];
  compact: boolean;
}) {
  const peers = useVoiceStore((s) => s.peers);
  const myPeerId = useVoiceStore((s) => s.myPeerId);
  const links = useVoiceStore((s) => s.links);
  const speaking = useVoiceStore((s) => s.speaking);
  const ptt = useVoiceStore((s) => s.pushToTalk);
  const mic = useVoiceStore((s) => s.mic);
  const byId = new Map(members.map((m) => [m.user.id, m.user]));
  const anyFailed = Object.values(links).includes('failed');
  const shown = peers.slice(0, compact ? 3 : 4);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${peers.length} in voice — show people`}
          data-testid="voice-people"
          className="flex h-8 items-center gap-1 rounded-control px-1 hover:bg-surface-2 pointer-coarse:h-11"
        >
          {shown.map((p) => {
            const u = byId.get(p.userId);
            return (
              <span
                key={p.peerId}
                data-testid="voice-avatar"
                data-speaking={Boolean(speaking[p.userId])}
                className={cn(
                  'rounded-full ring-2 ring-offset-1 ring-offset-bg transition-[box-shadow] duration-100',
                  speaking[p.userId] ? 'ring-success' : 'ring-transparent',
                )}
              >
                {u ? (
                  <Avatar user={u} className="size-6 text-[11px]" />
                ) : (
                  <Users className="size-6 p-1 text-text-muted" aria-hidden />
                )}
              </span>
            );
          })}
          {peers.length > shown.length && (
            <span className="px-0.5 text-[11px] text-text-muted">
              +{peers.length - shown.length}
            </span>
          )}
          {anyFailed && <AlertTriangle className="size-3.5 text-warning" aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="glass z-[1300] w-72 rounded-panel p-3"
          data-testid="voice-panel"
        >
          <p className="text-[13px] font-semibold text-text">
            In voice · {peers.length}/{VOICE_MAX_PEERS}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {peers.map((p) => {
              const u = byId.get(p.userId);
              const me = p.peerId === myPeerId;
              const link = me ? 'connected' : (links[p.peerId] ?? 'connecting');
              return (
                <li
                  key={p.peerId}
                  data-testid="voice-row"
                  data-user={u?.username}
                  data-link={link}
                  data-speaking={Boolean(speaking[p.userId])}
                  className="flex items-center gap-2 rounded-control px-1 py-1"
                >
                  <span
                    className={cn(
                      'rounded-full ring-2 ring-offset-1 ring-offset-bg',
                      speaking[p.userId] ? 'ring-success' : 'ring-transparent',
                    )}
                  >
                    {u ? (
                      <Avatar user={u} className="size-7 text-xs" />
                    ) : (
                      <Users className="size-7 p-1 text-text-muted" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                    {u?.displayName ?? 'Teammate'}
                    {me && <span className="text-text-muted"> (you)</span>}
                  </span>
                  {link === 'connecting' && (
                    <span className="flex items-center gap-1 text-[11px] text-text-muted">
                      <Loader2 className="size-3 animate-spin" aria-hidden /> Connecting
                    </span>
                  )}
                  {link === 'failed' && (
                    <span
                      className="flex items-center gap-1 text-[11px] text-warning"
                      title="Their network or yours blocks the call — retrying"
                    >
                      <AlertTriangle className="size-3" aria-hidden /> Can’t connect
                    </span>
                  )}
                  {p.muted && (
                    <MicOff className="size-3.5 text-text-muted" aria-label="Muted" role="img" />
                  )}
                </li>
              );
            })}
          </ul>
          {mic && (
            <p
              className="mt-2 text-[12px] leading-snug text-warning"
              data-testid="voice-mic-problem"
            >
              {MIC_PROBLEM_TEXT[mic]}
            </p>
          )}
          <label className="mt-2 flex cursor-pointer items-center justify-between gap-2 border-t border-border pt-2 text-[13px] text-text">
            <span>
              Push to talk
              <span className="block text-[11px] text-text-muted">
                Hold the ` key or the mic button
              </span>
            </span>
            <input
              type="checkbox"
              data-testid="voice-ptt"
              checked={ptt}
              disabled={Boolean(mic) || !voice}
              onChange={(e) => {
                if (voice) savePushToTalk(voice, e.target.checked);
              }}
              className="size-4 accent-[var(--accent)]"
            />
          </label>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
