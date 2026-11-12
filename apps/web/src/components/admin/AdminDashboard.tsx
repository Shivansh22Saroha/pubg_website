'use client';

import { AdminStatsResponseSchema, isMapId, MAPS, type AdminStats } from '@rotationlab/shared';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { notFound } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const fmt = new Intl.NumberFormat('en-IN');
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Site admin dashboard (FEATURES F16): who uses RotationLab. Only ADMIN_EMAILS accounts get
 * data; for anyone else the API answers 404 and so does this page.
 */
export function AdminDashboard() {
  const q = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async ({ signal }) =>
      (await api('/admin/stats', { schema: AdminStatsResponseSchema, signal })).stats,
    retry: false,
    refetchInterval: 60_000,
  });
  if (q.error instanceof ApiError && q.error.status === 404) notFound();
  const s = q.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="font-display text-[44px] leading-none font-bold">Admin</h1>
          <p className="mt-1 text-sm text-text-muted">
            {s
              ? `Updated ${dateTime.format(new Date(s.generatedAt))} · refreshes every minute`
              : 'Loading…'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>

      {q.isError && !(q.error instanceof ApiError && q.error.status === 404) && (
        <p role="alert" className="border-l-4 border-danger bg-surface px-4 py-3 text-sm">
          Couldn&apos;t load the numbers: {q.error.message}. Try Refresh.
        </p>
      )}

      {s && (
        <>
          <section aria-labelledby="people" className="flex flex-col gap-3">
            <h2 id="people" className="section-label text-text-muted">
              People
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile
                label="Accounts"
                value={s.totals.users}
                hint={`${fmt.format(s.totals.verifiedUsers)} verified email`}
                lead
              />
              <Tile
                label="Active today"
                value={s.active.last24h}
                hint="logged in or came back, last 24 h"
              />
              <Tile label="Active this week" value={s.active.last7d} hint="last 7 days" />
              <Tile label="Active this month" value={s.active.last30d} hint="last 30 days" />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <DayBars title="New accounts per day" unit="new accounts" days={s.signupsByDay} />
            <DayBars title="Active accounts per day" unit="active accounts" days={s.activeByDay} />
          </div>

          <section aria-labelledby="usage" className="flex flex-col gap-3">
            <h2 id="usage" className="section-label text-text-muted">
              What they made
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Tile label="Rooms" value={s.totals.rooms} />
              <Tile label="Boards" value={s.totals.boards} />
              <Tile label="Drawings" value={s.totals.drawings} hint="lines, zones, markers…" />
              <Tile label="Chat messages" value={s.totals.chatMessages} />
              <Tile label="Snapshots" value={s.totals.snapshots} />
              <Tile label="Share links" value={s.totals.shareLinks} />
            </div>
            <MapSplit boards={s.boardsByMap} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section
              aria-labelledby="top-rooms"
              className="surface-raised overflow-hidden rounded-panel"
            >
              <h2 id="top-rooms" className="section-label border-b px-4 py-3">
                Busiest rooms
              </h2>
              <Table
                empty="No rooms yet."
                head={['Room', 'Members', 'Boards', 'Drawings']}
                rows={s.topRooms.map((r) => [r.name, r.members, r.boards, r.drawings])}
              />
            </section>
            <section
              aria-labelledby="recent"
              className="surface-raised overflow-hidden rounded-panel"
            >
              <h2 id="recent" className="section-label border-b px-4 py-3">
                Newest accounts
              </h2>
              <Table
                empty="No accounts yet."
                head={['User', 'Email', 'Rooms', 'Joined']}
                rows={s.recentUsers.map((u) => [
                  u.displayName.toLowerCase() === u.username.toLowerCase()
                    ? `@${u.username}`
                    : `${u.displayName} (@${u.username})`,
                  `${u.emailMasked}${u.verified ? '' : ' · unverified'}`,
                  u.rooms,
                  dateTime.format(new Date(u.createdAt)),
                ])}
              />
            </section>
          </div>
          <p className="text-xs text-text-muted">
            Emails are masked on purpose. &quot;Active&quot; counts accounts that logged in or
            refreshed a session; visitors who never signed up aren&apos;t counted here.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  lead,
}: {
  label: string;
  value: number;
  hint?: string;
  lead?: boolean;
}) {
  return (
    <div
      className={cn('surface-raised rounded-panel px-4 py-3', lead && 'border-l-4 border-l-accent')}
    >
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      <p className="mt-1 font-display text-[44px] leading-none font-bold tabular-nums">
        <span className="block pt-[4px]">{fmt.format(value)}</span>
      </p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/** One series per chart (no legend: the title names it), gold bars, hover / focus tooltip. */
function DayBars({
  title,
  unit,
  days,
}: {
  title: string;
  unit: string;
  days: AdminStats['signupsByDay'];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, d) => a + d.count, 0);
  const shown = hover ?? days.length - 1;
  const cur = days[shown];
  return (
    <section className="surface-raised flex flex-col gap-3 rounded-panel p-4" aria-label={title}>
      <div className="flex items-baseline gap-2">
        <h2 className="section-label mr-auto">{title}</h2>
        <span className="text-xs text-text-muted">{fmt.format(total)} in 30 days</span>
      </div>
      <p className="h-5 text-sm" aria-live="polite">
        {cur && (
          <>
            <span className="font-semibold tabular-nums">{fmt.format(cur.count)}</span>{' '}
            <span className="text-text-muted">
              {unit} · {day.format(new Date(`${cur.date}T00:00:00Z`))}
              {hover === null ? ' (today)' : ''}
            </span>
          </>
        )}
      </p>
      <div
        className="flex h-36 items-end gap-[2px] border-b border-border"
        onMouseLeave={() => {
          setHover(null);
        }}
      >
        {days.map((d, i) => (
          <button
            key={d.date}
            type="button"
            aria-label={`${day.format(new Date(`${d.date}T00:00:00Z`))}: ${d.count} ${unit}`}
            onMouseEnter={() => {
              setHover(i);
            }}
            onFocus={() => {
              setHover(i);
            }}
            onBlur={() => {
              setHover(null);
            }}
            className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-accent"
          >
            <span
              className={cn(
                'block w-full rounded-t-[4px] bg-accent transition-opacity',
                hover !== null && hover !== i && 'opacity-45',
              )}
              style={{ height: `${d.count === 0 ? 0 : Math.max(3, (d.count / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>{days[0] ? day.format(new Date(`${days[0].date}T00:00:00Z`)) : ''}</span>
        <span>Today</span>
      </div>
      <details className="text-xs text-text-muted">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-2 w-full tabular-nums">
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{day.format(new Date(`${d.date}T00:00:00Z`))}</td>
                <td className="text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function MapSplit({ boards }: { boards: AdminStats['boardsByMap'] }) {
  const total = boards.reduce((a, b) => a + b.boards, 0);
  if (total === 0) return null;
  return (
    <div className="surface-raised flex flex-wrap gap-x-8 gap-y-2 rounded-panel px-4 py-3 text-sm">
      <span className="font-semibold text-text-muted">Boards by map</span>
      {boards.map((b) => {
        const name = isMapId(b.mapId) ? MAPS[b.mapId].name : b.mapId;
        return (
          <span key={b.mapId}>
            {name} <span className="font-semibold tabular-nums">{fmt.format(b.boards)}</span>{' '}
            <span className="text-text-muted">({Math.round((b.boards / total) * 100)}%)</span>
          </span>
        );
      })}
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted">
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  'px-4 py-2 font-semibold',
                  i > 0 && typeof rows[0]?.[i] === 'number' && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-border">
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={cn(
                    'px-4 py-2',
                    typeof c === 'number' ? 'text-right tabular-nums' : 'max-w-[16rem] truncate',
                  )}
                >
                  {typeof c === 'number' ? fmt.format(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
