'use client';

import { Hint } from '@/components/ui/hint';
import type { RecallData } from '@/lib/recalls';
import { cn } from '@/lib/utils';
import { RECALL_GREEN, RECALL_HEART } from './RecallLayer';

const hudButton =
  'flex size-8 items-center justify-center rounded-control text-text transition-colors duration-150 ease-hud hover:bg-surface-2';
const pressedButton =
  'bg-[linear-gradient(180deg,var(--accent-hi),var(--accent))] text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] hover:brightness-105';

export function RecallHeartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={RECALL_HEART} fill={RECALL_GREEN} stroke="#fff" strokeWidth={1.8} />
    </svg>
  );
}

/**
 * Map HUD: the Recalls toggle (show / hide every recall tower, like Grid). Only on maps that
 * have recall data; on by default, remembered per device by the caller.
 */
export function RecallControl({
  on,
  onChange,
  data,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  data: RecallData;
}) {
  if (data.status !== 'ready') return null;
  return (
    <Hint
      label="Recalls"
      description={`Show or hide all ${data.file.towers.length} recall towers. From PUBG PC matches; BGMI's may differ a little.`}
      side="top"
    >
      <button
        type="button"
        aria-label="Recalls"
        aria-pressed={on}
        data-testid="recalls-toggle"
        onClick={() => {
          onChange(!on);
        }}
        className={cn(hudButton, on && pressedButton)}
      >
        <RecallHeartIcon className="size-[18px]" />
      </button>
    </Hint>
  );
}
