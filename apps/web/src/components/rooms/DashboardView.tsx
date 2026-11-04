'use client';

import { Map, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { JoinWithCode } from '@/components/rooms/JoinWithCode';
import { NewRoomDialog } from '@/components/rooms/NewRoomDialog';
import { RoomCard } from '@/components/rooms/RoomCard';
import { useMe } from '@/hooks/useMe';
import { useRooms } from '@/lib/rooms';

/** UI_UX_SPEC §3.3 (server-seeded by `app/(app)/dashboard/page.tsx`). */
export function DashboardView() {
  const { data: user } = useMe();
  const rooms = useRooms();
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () =>
      (rooms.data ?? []).filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase())),
    [rooms.data, query],
  );
  if (!user) return null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1
          className="mr-auto font-display text-[32px] leading-tight font-bold"
          data-testid="dashboard-greeting"
        >
          Welcome, {user.displayName}
        </h1>
        {(rooms.data?.length ?? 0) > 0 && (
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
              aria-hidden
            />
            <Input
              aria-label="Search rooms"
              placeholder="Search rooms…"
              className="pl-9"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
        )}
        <NewRoomDialog />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <section aria-labelledby="rooms-heading" className="flex flex-col gap-3">
          <h2 id="rooms-heading" className="section-label text-sm text-text-muted">
            Your rooms
          </h2>
          {rooms.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[4/3] animate-pulse rounded-panel bg-surface" />
              ))}
            </div>
          ) : rooms.error ? (
            <p role="alert" className="text-danger">
              Could not load your rooms.
            </p>
          ) : rooms.data.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-border-strong p-10 text-center">
              <Map className="size-10 text-text-muted" aria-hidden />
              <p className="font-display text-xl font-bold">No rooms yet</p>
              <p className="max-w-sm text-sm text-text-muted">
                Create a room for your squad, then invite your teammates with a link or code.
              </p>
              <NewRoomDialog />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-text-muted">No rooms match “{query}”.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((room, i) => (
                <RoomCard key={room.id} room={room} priority={i === 0} />
              ))}
            </div>
          )}
        </section>
        <aside className="rounded-panel panel-hard bg-surface p-4">
          <JoinWithCode />
        </aside>
      </div>
    </div>
  );
}
