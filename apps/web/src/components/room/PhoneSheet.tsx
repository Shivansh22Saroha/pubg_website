'use client';

import { History, MessageSquare, Route, Users } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { PanelTab } from '@/stores/workspaceStore';
import { UnreadBadge } from './SidePanel';

/** the phone sheet's sections (exact room demo), stored in the shared panel-tab slot */
export const PHONE_TABS = [
  { id: 'plan', label: 'Routes', Icon: Route },
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'members', label: 'Squad', Icon: Users },
  { id: 'replay', label: 'Replay', Icon: History },
] as const satisfies readonly { id: PanelTab; label: string; Icon: unknown }[];
export type PhoneTab = (typeof PHONE_TABS)[number]['id'];

/** a stored tab from another layout maps onto the nearest phone section */
export function phoneTab(stored: PanelTab): PhoneTab {
  return stored === 'layers' ? 'plan' : stored;
}

/**
 * Phone held upright (exact room demo, UI_UX_SPEC §3.5): the map fills the screen and a glass
 * sheet stays docked at the bottom — a grab handle and the Routes · Chat · Squad · Replay
 * switch. Tapping a section opens the sheet to about half the screen; tapping it again (or the
 * handle, or a swipe down on it) folds it back to the switch. The tool dock floats just above.
 * Reports its height so map overlays (zoom, readout, style bar) ride above it.
 */
export function PhoneSheet({
  open,
  onOpenChange,
  tab,
  onTab,
  unread,
  hidden,
  dock,
  onHeight,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: PhoneTab;
  onTab: (tab: PhoneTab) => void;
  unread: number;
  /** Full map: the sheet slides away, the dock stays */
  hidden: boolean;
  dock: ReactNode;
  onHeight: (px: number, open: boolean) => void;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const report = useRef(onHeight);
  useLayoutEffect(() => {
    report.current = onHeight;
  });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      report.current(Math.round(el.getBoundingClientRect().height), open);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [open, hidden]);

  return (
    <div
      ref={wrap}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col',
        'transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
      )}
      style={
        hidden
          ? { transform: 'translateY(calc(100% - 4.5rem - env(safe-area-inset-bottom)))' }
          : undefined
      }
    >
      <div className="pointer-events-auto flex justify-center px-2 pb-2 [&>nav]:max-w-full">
        {dock}
      </div>
      <section
        aria-label="Room panel"
        data-testid="phone-sheet"
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'glass-panel pointer-events-auto flex flex-col rounded-b-none border-b-0 !bg-[rgba(13,16,15,0.9)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          hidden && 'invisible',
        )}
      >
        <button
          type="button"
          aria-label={open ? 'Fold the panel' : 'Open the panel'}
          aria-expanded={open}
          data-testid="phone-sheet-grab"
          className="flex h-6 w-full shrink-0 touch-none items-center justify-center"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.moved) return;
            const dy = e.clientY - d.y;
            if (Math.abs(dy) > 28) {
              d.moved = true;
              onOpenChange(dy < 0);
            }
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved) onOpenChange(!open);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-white/25" />
        </button>
        <div
          role="tablist"
          aria-label="Room panel sections"
          className="flex shrink-0 gap-1 rounded-[12px] bg-white/[0.04] p-1"
        >
          {PHONE_TABS.map(({ id, label, Icon }) => {
            const on = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                data-testid={`phone-tab-${id}`}
                onClick={() => {
                  if (on && open) onOpenChange(false);
                  else {
                    onTab(id);
                    onOpenChange(true);
                  }
                }}
                className={cn(
                  'relative flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-semibold transition-colors',
                  on && open ? 'bg-white/[0.1] text-text' : 'text-text-muted',
                )}
              >
                <Icon className={cn('size-4 shrink-0', on && open && 'text-accent')} aria-hidden />
                <span className="truncate">{label}</span>
                {id === 'chat' && unread > 0 && !(on && open) && (
                  <span className="absolute top-0.5 right-1">
                    <UnreadBadge count={unread} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div
          className={cn(
            'min-h-0 overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            open ? 'h-[min(52dvh,30rem)]' : 'h-0',
          )}
          aria-hidden={!open}
          inert={!open}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
