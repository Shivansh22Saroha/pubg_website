import { ATTRIBUTION_TEXT, BGMI_NOTICE, PRODUCT_NAME } from '@rotationlab/shared';
import { Crosshair } from 'lucide-react';
import { HealthStatus } from '@/components/HealthStatus';

// Phase 1 placeholder — the real landing page arrives in Phase 9 (UI_UX_SPEC §3.1).
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center border-b px-4">
        <span className="flex items-center gap-2 font-display text-lg font-bold tracking-wide">
          <Crosshair className="size-[18px] text-accent" aria-hidden />
          {PRODUCT_NAME}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
        <div className="text-center">
          <p className="section-label mb-2 text-xs text-accent">Phase 1 · Scaffold</p>
          <h1 className="font-display text-[32px] leading-tight font-bold">
            Plan your rotations together.
          </h1>
          <p className="mt-2 text-text-muted">
            Erangel, Miramar and Rondo — one shared, zoomable map for your squad.
          </p>
        </div>
        <HealthStatus />
      </main>

      <footer className="border-t px-4 py-4 text-center text-xs text-text-muted">
        <p>{ATTRIBUTION_TEXT}</p>
        <p className="mt-1">{BGMI_NOTICE}</p>
      </footer>
    </div>
  );
}
