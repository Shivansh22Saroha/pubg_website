'use client';

import type { MapId } from '@rotationlab/shared';
import dynamic from 'next/dynamic';

// Leaflet touches `window` at import time → client-only.
const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-text-muted">Loading map…</div>
  ),
});

export function MapView({ mapId }: { mapId: MapId }) {
  return <MapCanvas mapId={mapId} />;
}
