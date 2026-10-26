'use client';

import { Eye } from 'lucide-react';
import { useFollowStore } from '@/stores/followStore';

/** "Following {name} · Stop" at the top of the map while following (FEATURES F8). */
export function FollowPill({ names }: { names: Record<string, string> }) {
  const leaderId = useFollowStore((s) => s.leaderId);
  if (!leaderId) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-4">
      <p
        role="status"
        data-testid="follow-pill"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-accent bg-surface/95 px-3 py-1 text-sm shadow-panel"
      >
        <Eye className="size-4 text-accent" aria-hidden />
        Following {names[leaderId] ?? 'a teammate'}
        <span aria-hidden className="text-text-muted">
          ·
        </span>
        <button
          type="button"
          className="font-semibold text-accent hover:underline"
          onClick={() => {
            useFollowStore.getState().dispatch({ type: 'stop' });
          }}
        >
          Stop
        </button>
      </p>
    </div>
  );
}
