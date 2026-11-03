'use client';

import { Ruler } from 'lucide-react';
import { useEffect, useState } from 'react';
import { shortcutsBlocked } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';

/** The read-only pages' measure switch (`/explore`, `/s/[token]`): R toggles it. */
export function useMeasureToggle() {
  const [measuring, setMeasuring] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutsBlocked(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') {
        setMeasuring((m) => !m);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return [measuring, setMeasuring] as const;
}

export const MEASURE_HINT =
  'Click points to measure · double-click or Enter to finish · Backspace removes a point · Esc clears';

export function MeasureButton({
  measuring,
  onToggle,
  testId,
}: {
  measuring: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={measuring}
      aria-label="Measure"
      title="Measure (R)"
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        'ml-auto flex h-9 items-center gap-1.5 rounded-control px-3 text-[13px] font-medium pointer-coarse:h-11',
        measuring ? 'bg-accent text-accent-fg' : 'text-text-muted hover:bg-surface-2',
      )}
    >
      <Ruler className="size-4" aria-hidden /> Measure
    </button>
  );
}
