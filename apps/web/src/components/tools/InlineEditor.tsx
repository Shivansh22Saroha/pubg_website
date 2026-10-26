'use client';

import type { Pt } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toLatLng } from '@/lib/coords';

/**
 * Inline input anchored at a map point (FEATURES F6): new text labels, and double-click edits
 * of a text's text or a marker's label. Enter commits, Esc cancels, blur commits. Plain
 * <input> value only — rendered later with textContent (CLAUDE.md rule 5).
 */
export function InlineEditor({
  map,
  at,
  initial = '',
  maxLength,
  label,
  onSubmit,
  onCancel,
}: {
  map: L.Map;
  at: Pt;
  initial?: string;
  maxLength: number;
  label: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [pos, setPos] = useState(() => map.latLngToContainerPoint(toLatLng(at)));

  useEffect(() => {
    const update = () => {
      setPos(map.latLngToContainerPoint(toLatLng(at)));
    };
    map.on('move zoom', update);
    if (wrap.current) L.DomEvent.disableClickPropagation(wrap.current);
    return () => {
      map.off('move zoom', update);
    };
  }, [map, at]);

  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value === null) onCancel();
    else onSubmit(value);
  };

  return createPortal(
    <div
      ref={wrap}
      data-rl-overlay=""
      className="absolute z-[1000]"
      style={{ left: pos.x, top: pos.y, transform: 'translate(-4px, -50%)' }}
    >
      <input
        autoFocus
        aria-label={label}
        defaultValue={initial}
        maxLength={maxLength}
        className="w-56 rounded-control border bg-black/60 px-2 py-1 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value);
          else if (e.key === 'Escape') finish(null);
          e.stopPropagation();
        }}
        onBlur={(e) => {
          finish(e.currentTarget.value);
        }}
      />
    </div>,
    map.getContainer(),
  );
}
