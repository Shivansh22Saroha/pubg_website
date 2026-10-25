'use client';

import { useMe } from '@/hooks/useMe';
import { Avatar } from '@/components/auth/UserMenu';

// Phase 3 placeholder — rooms list, empty state and dialogs arrive in Phase 4 (UI_UX_SPEC §3.3).
export default function DashboardPage() {
  const { data: user } = useMe();
  if (!user) return null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-4">
        <Avatar user={user} className="size-12 text-xl" />
        <div>
          <h1
            className="font-display text-[32px] leading-tight font-bold"
            data-testid="dashboard-greeting"
          >
            Welcome, {user.displayName}
          </h1>
          <p className="text-text-muted">
            @{user.username} · {user.email}
          </p>
        </div>
      </div>
      <section className="rounded-panel border bg-surface p-6">
        <h2 className="section-label text-sm text-text-muted">Your rooms</h2>
        <p className="mt-2 text-text-muted">Rooms arrive in the next phase.</p>
      </section>
    </div>
  );
}
