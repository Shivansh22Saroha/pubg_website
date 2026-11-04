'use client';

import { MAPS, type MapId, type RoomRole } from '@rotationlab/shared';
import { useState } from 'react';
import { env } from '@/env';
import { cn } from '@/lib/utils';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');

/**
 * Map image from the tile build — 256 px `thumb` or 512 px `card` — with a labelled
 * fallback when tiles aren't installed.
 */
export function MapThumb({
  mapId,
  className,
  variant = 'thumb',
  priority = false,
  src,
}: {
  mapId: MapId;
  className?: string;
  variant?: 'thumb' | 'card';
  /** a board thumbnail (Phase 11); falls back to the map image when missing or broken */
  src?: string | null;
  /** above the fold and likely the LCP (the first dashboard card): fetch first, never lazy */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [customFailed, setCustomFailed] = useState(false);
  const custom = src && !customFailed ? src : null;
  return (
    <div className={cn('relative overflow-hidden bg-surface-2', className)}>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- static tile asset, no optimisation wanted
        <img
          src={
            custom ??
            `${tilesBase}/${variant === 'card' ? MAPS[mapId].card : MAPS[mapId].thumbnail}`
          }
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          {...(priority ? { fetchPriority: 'high' as const } : {})}
          className="size-full object-cover"
          onError={() => {
            if (custom) setCustomFailed(true);
            else setFailed(true);
          }}
        />
      )}
      {failed && (
        <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-text-muted">
          {MAPS[mapId].name}
        </span>
      )}
    </div>
  );
}

// Phase 13: solid blocks (dark text on the fill: ≥ 7:1 for owner / editor)
const ROLE_STYLE: Record<RoomRole, string> = {
  OWNER: 'border-bg bg-accent text-accent-fg',
  EDITOR: 'border-bg bg-info text-accent-fg',
  VIEWER: 'border-border-strong bg-surface-2 text-text',
};
const ROLE_LABEL: Record<RoomRole, string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };

export function RoleBadge({ role }: { role: RoomRole }) {
  return (
    <span
      className={cn(
        'rounded-control border-2 px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase',
        ROLE_STYLE[role],
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

/** "2h ago" style relative time for cards. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Radio cards to pick one of the maps (UI_UX_SPEC §3.3 new-room dialog). */
export function MapPicker({
  value,
  onChange,
  name,
}: {
  value: MapId;
  onChange: (m: MapId) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label="Map" className="grid grid-cols-3 gap-2">
      {(Object.keys(MAPS) as MapId[]).map((id) => (
        <label
          key={id}
          className={cn(
            'cursor-pointer overflow-hidden rounded-control border-2 transition-colors',
            value === id ? 'border-accent' : 'border-transparent hover:border-border',
          )}
        >
          <input
            type="radio"
            name={name}
            value={id}
            checked={value === id}
            onChange={() => {
              onChange(id);
            }}
            className="sr-only"
          />
          <MapThumb mapId={id} className="aspect-square" />
          <span className="block bg-surface-2 py-1 text-center text-xs font-medium">
            {MAPS[id].name}
          </span>
        </label>
      ))}
    </div>
  );
}
