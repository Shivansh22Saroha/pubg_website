'use client';

import { SendHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import {
  FALLBACK_SUGGESTIONS,
  STARTERS,
  byId,
  type Intent,
  type SpotterLink,
} from '@/lib/spotter/knowledge';
import { match } from '@/lib/spotter/match';
import { cn } from '@/lib/utils';
import { SpotterIcon } from './SpotterIcon';

interface Message {
  id: number;
  from: 'you' | 'spotter';
  text: string;
  link?: SpotterLink;
  chips?: string[];
}

const MAX_QUESTION = 200;
const GREETING: Omit<Message, 'id'> = {
  from: 'spotter',
  text: 'Spotter here. Ask me how RotationLab works, or for BGMI tactics — drops, rotations, zones.',
  chips: STARTERS,
};

let nextId = 1;
/** the conversation survives closing and reopening the panel (not a reload) */
let history: Message[] = [{ id: 0, ...GREETING }];

function reply(intent: Intent | null): Omit<Message, 'id'> {
  if (!intent) {
    return {
      from: 'spotter',
      text: "I don't know that one yet — I only know RotationLab and BGMI basics. Try a shorter question, or one of these:",
      chips: FALLBACK_SUGGESTIONS,
    };
  }
  return { from: 'spotter', text: intent.answer, link: intent.link, chips: intent.next };
}

/**
 * Spotter's chat panel. Answers come from the built-in knowledge base (lib/spotter) and render
 * as plain text. Non-modal: the page stays usable; Esc or × closes and focus goes back to
 * whatever opened it.
 */
export function SpotterPanel({
  placement,
  onClose,
}: {
  placement: 'bottom' | 'top' | 'room';
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(history);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const opener = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    return () => {
      clearTimeout(timer.current);
      if (opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    history = messages;
    log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [messages, thinking]);

  const ask = (text: string, intent?: Intent) => {
    const q = text.trim().slice(0, MAX_QUESTION);
    if (!q || thinking) return;
    setMessages((m) => [...m, { id: nextId++, from: 'you', text: q }]);
    setDraft('');
    const answer = reply(intent ?? match(q).intent);
    // a beat of "typing", so the answer reads as a reply rather than a page change
    const delay = prefersReducedMotion() ? 0 : 420;
    setThinking(true);
    timer.current = setTimeout(() => {
      setThinking(false);
      setMessages((m) => [...m, { id: nextId++, ...answer }]);
    }, delay);
  };

  const submit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    ask(draft);
  };

  return (
    <section
      id="spotter-panel"
      role="dialog"
      aria-labelledby="spotter-title"
      data-testid="spotter-panel"
      onKeyDown={(e) => {
        // only while focus is inside: on the map, Esc belongs to the drawing tools
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        'rl-spotter-in fixed right-4 z-[950] flex w-[min(380px,calc(100vw-32px))] max-sm:right-2 max-sm:w-[calc(100vw-16px)] flex-col overflow-hidden border border-white/10 bg-[#0b0b0b] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)]',
        placement === 'bottom' && 'bottom-[88px] h-[min(560px,calc(100dvh-112px))]',
        placement === 'top' && 'top-[128px] h-[min(540px,calc(100dvh-144px))]',
        placement === 'room' && 'top-[56px] h-[min(560px,calc(100dvh-72px))]',
      )}
    >
      <header className="flex items-center gap-3 bg-accent py-2 pr-2 pl-4 text-accent-fg">
        <SpotterIcon className="size-6" />
        <div className="min-w-0 flex-1">
          <h2 id="spotter-title" className="font-display text-[26px] leading-none uppercase">
            <span className="block pt-[3px]">Spotter</span>
          </h2>
          <p className="text-[11px] font-semibold tracking-[0.04em] text-accent-fg/75 uppercase">
            Site help &amp; BGMI tactics
          </p>
        </div>
        <button
          type="button"
          aria-label="Close Spotter"
          onClick={onClose}
          className="flex size-10 items-center justify-center text-accent-fg hover:bg-black/10 focus-visible:outline-accent-fg"
        >
          <X className="size-5" />
        </button>
      </header>

      <ol
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation with Spotter"
        className="bgmi-dots flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((m) => (
          <li
            key={m.id}
            className={cn('flex flex-col gap-2', m.from === 'you' ? 'items-end' : 'items-start')}
          >
            <p
              className={cn(
                'max-w-[88%] px-3 py-2 text-[14px] leading-relaxed whitespace-pre-line',
                m.from === 'you'
                  ? 'bg-accent text-accent-fg'
                  : 'border-l-[3px] border-accent bg-[#161616] text-text',
              )}
            >
              <span className="sr-only">{m.from === 'you' ? 'You: ' : 'Spotter: '}</span>
              {m.text}
            </p>
            {m.link && (
              <Link
                href={m.link.href}
                className="font-display text-[18px] leading-none text-accent uppercase underline-offset-4 hover:underline"
              >
                <span className="pt-[3px]">{m.link.label} ›</span>
              </Link>
            )}
            {m.chips && m.chips.length > 0 && (
              <div className="flex max-w-full flex-wrap gap-1.5">
                {m.chips.map((id) => {
                  const intent = byId.get(id);
                  if (!intent) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={thinking}
                      onClick={() => {
                        ask(intent.question, intent);
                      }}
                      className="border border-white/25 bg-black px-2.5 py-1.5 text-left text-[12.5px] text-text transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {intent.question}
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
        {thinking && (
          <li aria-label="Spotter is typing" className="flex items-center gap-1 px-1 py-2">
            <span className="rl-typing" />
            <span className="rl-typing [animation-delay:120ms]" />
            <span className="rl-typing [animation-delay:240ms]" />
          </li>
        )}
      </ol>

      <form
        method="post"
        onSubmit={submit}
        className="flex gap-2 border-t border-white/10 bg-black p-3"
      >
        <label htmlFor="spotter-input" className="sr-only">
          Your question
        </label>
        <input
          ref={input}
          id="spotter-input"
          value={draft}
          maxLength={MAX_QUESTION}
          autoComplete="off"
          placeholder="Ask about drops, rotations, tools…"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="h-11 min-w-0 flex-1 border border-white/15 bg-[#111] px-3 text-[14px] text-text placeholder:text-text-muted focus-visible:border-accent"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!draft.trim() || thinking}
          className="flex size-11 shrink-0 items-center justify-center bg-accent text-accent-fg hover:brightness-110 disabled:bg-[#222] disabled:text-text-muted"
        >
          <SendHorizontal className="size-5" />
        </button>
      </form>
    </section>
  );
}
