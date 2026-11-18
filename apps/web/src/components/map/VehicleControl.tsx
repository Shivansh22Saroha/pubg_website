'use client';

import { VEHICLE_KINDS, VEHICLE_KIND_NAMES, type VehicleKind } from '@rotationlab/shared';
import { Car, SlidersHorizontal } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { SpawnData, VehiclePrefs } from '@/lib/vehicleSpawns';
import { VEHICLE_COLORS, VEHICLE_GLYPHS } from './VehicleLayer';

function KindIcon({ kind }: { kind: VehicleKind }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        d={VEHICLE_GLYPHS[kind]}
        fill="none"
        stroke={VEHICLE_COLORS[kind]}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const hudButton =
  'flex size-8 items-center justify-center rounded-control text-text transition-colors duration-150 ease-hud hover:bg-surface-2';
const pressedButton =
  'bg-[linear-gradient(180deg,var(--accent-hi),var(--accent))] text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] hover:brightness-105';

/**
 * Map HUD: the Vehicles toggle (show / hide spawn points, like Grid) and, while it's on, a
 * filter button whose popover picks the kinds and says where the data comes from. Remembered
 * per device by the caller.
 */
export function VehicleControl({
  prefs,
  onChange,
  data,
}: {
  prefs: VehiclePrefs;
  onChange: (p: VehiclePrefs) => void;
  data: SpawnData;
}) {
  const counts = new Map<VehicleKind, number>();
  if (data.status === 'ready')
    for (const s of data.file.spawns) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const none = prefs.on && data.status === 'none';

  return (
    <>
      <Hint
        label="Vehicles"
        description={none ? 'No spawn data for this map yet' : 'Show or hide vehicle spawn points'}
        side="top"
      >
        <button
          type="button"
          aria-label="Vehicles"
          aria-pressed={prefs.on}
          data-testid="vehicles-toggle"
          onClick={() => {
            onChange({ ...prefs, on: !prefs.on });
          }}
          className={cn(hudButton, prefs.on && pressedButton)}
        >
          <Car className="size-[18px]" />
        </button>
      </Hint>
      {prefs.on && (
        <Popover.Root>
          <Hint label="Vehicle types" description="Pick which vehicles to show" side="top">
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label="Vehicle types"
                data-testid="vehicles-filter"
                className={hudButton}
              >
                <SlidersHorizontal className="size-4" />
              </button>
            </Popover.Trigger>
          </Hint>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="end"
              sideOffset={10}
              collisionPadding={8}
              className="glass z-[1300] w-64 rounded-panel p-3"
              data-testid="vehicles-panel"
            >
              <p className="text-[13px] font-semibold text-text">Vehicle spawns</p>
              {data.status === 'none' ? (
                <p className="mt-1 text-[12px] text-text-muted">No spawn data for this map yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {VEHICLE_KINDS.map((kind) => {
                    const on = prefs.kinds.includes(kind);
                    return (
                      <li key={kind}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-control px-1.5 py-1 text-[13px] text-text hover:bg-surface-2 pointer-coarse:min-h-11">
                          <input
                            type="checkbox"
                            checked={on}
                            data-testid={`vehicles-kind-${kind}`}
                            onChange={() => {
                              const kinds = on
                                ? prefs.kinds.filter((k) => k !== kind)
                                : VEHICLE_KINDS.filter(
                                    (k) => k === kind || prefs.kinds.includes(k),
                                  );
                              onChange({ ...prefs, kinds });
                            }}
                            className="accent-[var(--accent)]"
                          />
                          <KindIcon kind={kind} />
                          <span className="flex-1">{VEHICLE_KIND_NAMES[kind]}</span>
                          {data.status === 'ready' && (
                            <span className="font-mono text-[11px] text-text-muted">
                              {counts.get(kind) ?? 0}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-text-muted">
                From PUBG PC matches (official PUBG API)
                {data.status === 'ready' ? `, ${data.file.matches} matches` : ''}. BGMI spawns may
                differ a little.
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </>
  );
}
