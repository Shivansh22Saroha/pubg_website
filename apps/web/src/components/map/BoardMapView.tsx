'use client';

import dynamic from 'next/dynamic';

// Leaflet touches `window` at import time → client-only.
export const BoardMapView = dynamic(() => import('./BoardMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-text-muted">Loading map…</div>
  ),
});
