'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBoardStore } from '@/stores/boardStore';

/** UI_UX_SPEC §7: hold this long without moving more than the slop to open the menu. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;

export interface LongPress {
  elementId: string;
  /** client coordinates of the press */
  x: number;
  y: number;
}

const MENU_W = 176;

/**
 * Touch context menu for the element under a long press: Delete, plus Edit label for markers
 * and text. Items are ≥ 44 px tall; Esc or a tap elsewhere closes it.
 */
export function LongPressMenu({
  menu,
  onClose,
  onEditLabel,
  onDelete,
}: {
  menu: LongPress;
  onClose: () => void;
  onEditLabel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const type = useBoardStore((s) => s.view.elements[menu.elementId]?.type);
  const labelled = type === 'MARKER' || type === 'TEXT';
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    // the lifting finger of the long press itself must not close it
    const t = window.setTimeout(() => {
      window.addEventListener('pointerdown', away, true);
    }, 0);
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  }, []);

  // the element went away (deleted by someone else): nothing to act on
  useEffect(() => {
    if (!type) close.current();
  }, [type]);

  const left = Math.max(8, Math.min(menu.x - MENU_W / 2, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(menu.y - 112, window.innerHeight - 120));
  const item =
    'flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2';

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Element actions"
      data-testid="long-press-menu"
      data-rl-overlay=""
      style={{ left, top, width: MENU_W }}
      className="fixed z-[2000] rounded-panel border bg-surface p-1 shadow-panel"
    >
      {labelled && (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onEditLabel(menu.elementId);
          }}
        >
          <Pencil className="size-4" aria-hidden /> {type === 'TEXT' ? 'Edit text' : 'Edit label'}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={`${item} text-danger`}
        onClick={() => {
          onDelete(menu.elementId);
        }}
      >
        <Trash2 className="size-4" aria-hidden /> Delete
      </button>
    </div>,
    document.body,
  );
}
