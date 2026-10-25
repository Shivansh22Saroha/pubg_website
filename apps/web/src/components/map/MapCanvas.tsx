'use client';

import 'leaflet/dist/leaflet.css';
import { MAPS, type MapId } from '@rotationlab/shared';
import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageOverlay, MapContainer, Pane, TileLayer } from 'react-leaflet';
import { env } from '@/env';
import { createCrs, worldBounds } from '@/lib/coords';
import { GRID_PANE, GridLayer } from './GridLayer';
import { GridLabels } from './GridLabels';
import { MapHud } from './MapHud';

export type BaseVariant = 'labels' | 'clean';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');
const tileUrl = (path: string) => `${tilesBase}/${path}/{z}/{y}/{x}.webp`;

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Client-only map (load with next/dynamic, ssr: false). Both base variants stay mounted and
 * swap by opacity, so the labels toggle never flashes blank; the 819 px low-res art sits
 * underneath while tiles stream in.
 */
export default function MapCanvas({ mapId }: { mapId: MapId }) {
  const config = MAPS[mapId];
  const { worldSize, gridCells, maxNativeZoom } = config;
  const crs = useMemo(() => createCrs(config), [config]);
  const bounds = useMemo(() => worldBounds(worldSize), [worldSize]);

  const [map, setMap] = useState<L.Map | null>(null);
  const [variant, setVariant] = useState<BaseVariant>('labels');
  const [grid, setGrid] = useState(true);

  const toggleLabels = useCallback(() => {
    setVariant((v) => (v === 'labels' ? 'clean' : 'labels'));
  }, []);
  const toggleGrid = useCallback(() => {
    setGrid((g) => !g);
  }, []);
  const fit = useCallback(() => {
    map?.fitBounds(bounds);
  }, [map, bounds]);

  // UI_UX_SPEC §8: N = labels, Shift+G = grid; never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key.toLowerCase() === 'n' && !e.shiftKey) toggleLabels();
      else if (e.key.toLowerCase() === 'g' && e.shiftKey) toggleGrid();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggleLabels, toggleGrid]);

  const tileOptions = {
    tileSize: config.tileSize,
    noWrap: true,
    bounds,
    minNativeZoom: 0,
    maxNativeZoom,
    keepBuffer: 4,
  } as const;

  return (
    <div
      data-testid="map-canvas"
      data-map={mapId}
      data-variant={variant}
      data-grid={grid ? 'on' : 'off'}
      className="relative h-full w-full overflow-hidden bg-bg"
    >
      <div className="absolute inset-0 isolate">
        <MapContainer
          ref={setMap}
          crs={crs}
          bounds={bounds}
          maxBounds={bounds.pad(0.1)}
          maxBoundsViscosity={1}
          minZoom={-1}
          maxZoom={maxNativeZoom + 2}
          zoomSnap={0.5}
          zoomDelta={0.5}
          wheelPxPerZoomLevel={120}
          zoomControl={false}
          attributionControl={false}
          className="h-full w-full !bg-bg"
          aria-label={`${config.name} map`}
        >
          <Pane name="placeholder" style={{ zIndex: 150 }}>
            <ImageOverlay
              url={`${tilesBase}/${config.lowres}`}
              bounds={bounds}
              pane="placeholder"
            />
          </Pane>
          <TileLayer
            {...tileOptions}
            url={tileUrl(config.variants.labels)}
            className="tiles-labels"
            opacity={variant === 'labels' ? 1 : 0}
            zIndex={variant === 'labels' ? 2 : 1}
          />
          <TileLayer
            {...tileOptions}
            url={tileUrl(config.variants.clean)}
            className="tiles-clean"
            opacity={variant === 'clean' ? 1 : 0}
            zIndex={variant === 'clean' ? 2 : 1}
          />
          {/* between tiles (200) and future drawing overlays (400) */}
          <Pane name={GRID_PANE} style={{ zIndex: 350 }}>
            {grid && <GridLayer worldSize={worldSize} cells={gridCells} />}
          </Pane>
        </MapContainer>
      </div>
      {map && grid && <GridLabels map={map} worldSize={worldSize} cells={gridCells} />}
      {map && (
        <MapHud
          map={map}
          worldSize={worldSize}
          labels={variant === 'labels'}
          grid={grid}
          onToggleLabels={toggleLabels}
          onToggleGrid={toggleGrid}
          onFit={fit}
        />
      )}
    </div>
  );
}
