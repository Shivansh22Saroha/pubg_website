'use client';

import { Tooltip } from 'radix-ui';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cn } from '@/lib/utils';

/** hold a button this long on a touch screen to see its name instead of pressing it */
export const HINT_LONG_PRESS_MS = 450;
const TOUCH_HINT_VISIBLE_MS = 1400;

/**
 * Hover / focus hint for icon buttons (UI_UX_SPEC §3.5): the button's name, an optional line
 * on what it does, and its keyboard shortcut. Mouse: on hover after a short delay; keyboard: on
 * focus. Touch has no hover, so holding the button shows the hint for a moment. Lifting the
 * finger still presses the button — a hint never swallows a tap (a slow phone, or a test
 * runner, can make a quick tap look like a hold). Purely visual — the button keeps its own
 * aria-label, so the bubble is aria-hidden to avoid announcing it twice.
 */
export function Hint({
  label,
  description,
  shortcut,
  side = 'right',
  children,
}: {
  label: string;
  description?: string;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** exactly one focusable element (the button) */
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const hideTimer = useRef(0);

  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const endPress = () => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    if (press.current.fired) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        setOpen(false);
      }, TOUCH_HINT_VISIBLE_MS);
    }
  };

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={400}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger
          asChild
          onPointerDown={(e) => {
            if (e.pointerType !== 'touch') return;
            if (press.current) window.clearTimeout(press.current.timer);
            const p = { fired: false, timer: 0 };
            p.timer = window.setTimeout(() => {
              p.fired = true;
              setOpen(true);
            }, HINT_LONG_PRESS_MS);
            press.current = p;
          }}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={(e) => {
            if (e.pointerType === 'touch') endPress();
          }}
          onContextMenu={(e) => {
            if (press.current) e.preventDefault(); // no OS menu over the hint
          }}
          onClick={() => {
            press.current = null;
          }}
        >
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={8}
            collisionPadding={8}
            aria-hidden
            data-testid="hint"
            className={cn(
              'glass z-[1400] max-w-60 rounded-control px-2.5 py-1.5 text-left shadow-lg',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-text">{label}</span>
              {shortcut && (
                <kbd className="rounded border border-border bg-surface-3 px-1.5 font-mono text-[11px] leading-5 text-text-muted">
                  {shortcut}
                </kbd>
              )}
            </span>
            {description && (
              <span className="mt-0.5 block text-[12px] leading-snug text-text-muted">
                {description}
              </span>
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
