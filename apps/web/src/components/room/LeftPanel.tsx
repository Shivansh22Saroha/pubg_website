'use client';

import type { Board, Member, RoomRole } from '@rotationlab/shared';
import { ChevronLeft } from 'lucide-react';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { Routes } from './PlanPanel';
import { LayersSection } from './SidePanel';

/**
 * Desktop left panel (glass layout, UI_UX_SPEC §3.5, from the approved room demo): route
 * options (Plan A / B / C, F24) on top, layers below. Collapses to the edge with the chevron or
 * [; the tab that stays behind brings it back.
 */
export function LeftPanel({
  role,
  session,
  members,
  meId,
  boards,
  onCollapse,
}: {
  role: RoomRole;
  session: RoomSession | null;
  members: Member[];
  meId: string;
  boards: Board[];
  onCollapse: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between py-2 pr-2 pl-4">
        <span className="font-display text-base font-semibold">Plan</span>
        <button
          type="button"
          aria-label="Hide left panel"
          title="Hide panel ([)"
          data-testid="left-panel-collapse"
          onClick={onCollapse}
          className="flex size-7 items-center justify-center rounded-[8px] border border-[var(--edge)] text-text-muted hover:bg-white/[0.06] hover:text-text"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-3 pt-1 pb-2">
          <Routes members={members} meId={meId} />
        </div>
        <section
          aria-labelledby="left-layers"
          className="mx-3 mb-3 border-t border-[var(--edge)] pt-3"
        >
          <h2 id="left-layers" className="mb-2 text-sm font-semibold">
            Layers
          </h2>
          <LayersSection
            role={role}
            session={session}
            members={members}
            meId={meId}
            boards={boards}
          />
        </section>
      </div>
    </div>
  );
}
