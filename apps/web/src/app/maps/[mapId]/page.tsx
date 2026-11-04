import { MAP_IDS, MAPS, PRODUCT_NAME, isMapId } from '@rotationlab/shared';
import { Crosshair } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapView } from '@/components/map/MapView';
import { devPagesEnabled, serverEnv } from '@/lib/serverEnv';
import { cn } from '@/lib/utils';
import { Providers } from '../../providers';

// Phase 2 dev page for eyeballing the three maps (TODO.md Phase 2). Off in production unless
// ENABLE_DEV_PAGES=true (Phase 9) — checked per request, so it needs no rebuild.
export const metadata: Metadata = { title: 'Map viewer', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function MapDevPage({ params }: { params: Promise<{ mapId: string }> }) {
  if (!devPagesEnabled(serverEnv())) notFound();
  const { mapId } = await params;
  if (!isMapId(mapId)) notFound();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
          <Crosshair className="size-[18px] text-accent" aria-hidden />
          {PRODUCT_NAME}
        </Link>
        <nav aria-label="Maps" className="flex gap-1">
          {MAP_IDS.map((id) => (
            <Link
              key={id}
              href={`/maps/${id}`}
              aria-current={id === mapId ? 'page' : undefined}
              className={cn(
                'rounded-control px-3 py-1.5 text-[13px] font-medium text-text-muted hover:bg-surface-2 hover:text-text',
                id === mapId && 'bg-surface-2 text-text shadow-[inset_0_-3px_0_var(--accent)]',
              )}
            >
              {MAPS[id].name}
            </Link>
          ))}
        </nav>
        <span className="ml-auto hidden text-xs text-text-muted sm:block">
          N labels · Shift+G grid · scroll to zoom
        </span>
      </header>
      <main className="relative min-h-0 flex-1">
        <Providers>
          <MapView key={mapId} mapId={mapId} />
        </Providers>
      </main>
    </div>
  );
}
