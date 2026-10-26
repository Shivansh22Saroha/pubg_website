'use client';

import 'leaflet/dist/leaflet.css';
import { MAPS, type MapId, type Pt } from '@rotationlab/shared';
import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ImageOverlay, MapContainer, Pane, TileLayer } from 'react-leaflet';
import { env } from '@/env';
import { createCrs, worldBounds } from '@/lib/coords';
import { isMacPlatform, resolveShortcut } from '@/lib/shortcuts';
import { GRID_PANE, GridLayer } from './GridLayer';
import { GridLabels } from './GridLabels';
import { MapHud } from './MapHud';

export type BaseVariant = 'labels' | 'clean';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');
const tileUrl = (path: string) => `${tilesBase}/${path}/{z}/{y}/{x}.webp`;

/**
 * Client-only map (load with next/dynamic, ssr: false). Both base variants stay mounted and
 * swap by opacity, so the labels toggle never flashes blank; the 819 px low-res art sits
 * underneath while tiles stream in.
 */
export default function MapCanvas({
  mapId,
  children,
  overlay,
  onCursor,
}: {
  mapId: MapId;
  /** board layers (elements, cursors…) rendered inside the Leaflet map */
  children?: ReactNode;
  /** DOM floating over the map, outside Leaflet (style bar, hints) */
  overlay?: ReactNode;
  /** world-unit pointer position over the map (null when it leaves) */
  onCursor?: (pt: Pt | null) => void;
}) {
  const config = MAPS[mapId];
  const { worldSize, gridCells, maxNativeZoom } = config;
  const crs = useMemo(() => createCrs(config), [config]);
  const bounds = useMemo(() => worldBounds(worldSize), [worldSize]);

  const [map, setMap] = useState<L.Map | null>(null);

  useEffect(() => {
    if (!map || !onCursor) return;
    // pointer events, not Leaflet's mouse events: a tool that claims a press cancels the
    // compat mouse events, and the cursor must keep streaming while dragging
    const container = map.getContainer();
    const move = (e: PointerEvent) => {
      const ll = map.mouseEventToLatLng(e);
      onCursor([ll.lng, ll.lat]);
    };
    const out = () => {
      onCursor(null);
    };
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerleave', out);
    return () => {
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerleave', out);
    };
  }, [map, onCursor]);
  // the view in world units on the DOM (data-center / data-zoom): tests and tooling read it
  const [view, setView] = useState<{ center: string; zoom: string }>({ center: '', zoom: '' });
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const c = map.getCenter();
      setView({ center: `${Math.round(c.lng)},${Math.round(c.lat)}`, zoom: String(map.getZoom()) });
    };
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map]);
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
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      const action = resolveShortcut(e, mac);
      if (action?.kind === 'labels') toggleLabels();
      else if (action?.kind === 'grid') toggleGrid();
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
      data-center={view.center}
      data-zoom={view.zoom}
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
            {grid && (
              <GridLayer worldSize={worldSize} cells={gridCells} maxNativeZoom={maxNativeZoom} />
            )}
          </Pane>
          {children}
        </MapContainer>
      </div>
      {map && grid && <GridLabels map={map} worldSize={worldSize} cells={gridCells} />}
      {overlay}
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
