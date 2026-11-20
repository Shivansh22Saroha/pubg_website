'use client';

import { MARKER_DEFAULT_COLORS, type MarkerKind, type Pt } from '@rotationlab/shared';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { markerElement } from '@/components/map/markerDom';
import { prefersReducedMotion } from '@/lib/motion';
import { MARKER_LABELS } from './Toolbar';

/** the kinds a quick drop offers, clockwise from the top (FEATURES F24) */
export const RADIAL_KINDS: readonly MarkerKind[] = [
  'enemy_squad',
  'drop',
  'hold',
  'danger',
  'vehicle',
  'pin',
];

export interface RadialAt {
  /** client px of the press / right-click */
  x: number;
  y: number;
  /** the world point the marker goes to */
  at: Pt;
}

const RADIUS = 76;
/** keep the whole ring on screen */
const MARGIN = RADIUS + 44;

/** a marker glyph, drawn by the same DOM builder as the map (no HTML strings) */
function Glyph({ kind }: { kind: MarkerKind }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(markerElement({ kind }, MARKER_DEFAULT_COLORS[kind] ?? '#F8FAFC'));
  }, [kind]);
  return <span ref={ref} aria-hidden className="rl-radial-glyph" />;
}

/**
 * Quick marker drop (FEATURES F24): right-click (or long-press on a phone) on an empty spot of
 * the map opens a ring of marker kinds around the pointer; one click drops that marker there.
 * Arrow keys move around the ring, Enter drops, Esc or a click elsewhere closes.
 */
export function RadialMenu({
  menu,
  onPick,
  onClose,
}: {
  menu: RadialAt;
  onPick: (kind: MarkerKind, at: Pt) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    buttons()[0]?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const list = buttons();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    };
    const t = window.setTimeout(() => {
      window.addEventListener('pointerdown', away, true);
    }, 0);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close.current);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', close.current);
    };
  }, []);

  const cx = Math.max(MARGIN, Math.min(menu.x, window.innerWidth - MARGIN));
  const cy = Math.max(MARGIN, Math.min(menu.y, window.innerHeight - MARGIN));
  const animate = !prefersReducedMotion();

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Drop a marker here"
      data-testid="radial-menu"
      data-rl-overlay=""
      className="fixed z-[2000]"
      style={{ left: cx, top: cy }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <span
        aria-hidden
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-[0_0_0_4px_rgba(0,0,0,0.45)]"
      />
      {RADIAL_KINDS.map((kind, i) => {
        const a = ((-90 + (i * 360) / RADIAL_KINDS.length) * Math.PI) / 180;
        const tx = Math.round(Math.cos(a) * RADIUS);
        const ty = Math.round(Math.sin(a) * RADIUS);
        return (
          <button
            key={kind}
            type="button"
            role="menuitem"
            data-kind={kind}
            onClick={() => {
              onPick(kind, menu.at);
            }}
            className="glass-panel absolute flex w-[84px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-[14px] px-1.5 py-1.5 text-[11px] leading-tight text-text hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
            style={{
              left: tx,
              top: ty,
              ...(animate && {
                animation: `rl-radial-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2) ${i * 25}ms backwards`,
              }),
            }}
          >
            <Glyph kind={kind} />
            {MARKER_LABELS[kind]}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
