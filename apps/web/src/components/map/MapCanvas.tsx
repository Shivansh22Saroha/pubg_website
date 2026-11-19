'use client';

import 'leaflet/dist/leaflet.css';
import type { Pt } from '@rotationlab/shared';
import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ImageOverlay, MapContainer, Pane, TileLayer } from 'react-leaflet';
import { env } from '@/env';
import type { BoardMapInfo } from '@/lib/boardMap';
import { createCrs, worldBounds } from '@/lib/coords';
import { prefersReducedMotion } from '@/lib/motion';
import { useSpawnData, useVehiclePrefs } from '@/lib/vehicleSpawns';
import { isMacPlatform, resolveShortcut } from '@/lib/shortcuts';
import { BoardMapContext } from './boardMapContext';
import { GRID_PANE, GridLayer } from './GridLayer';
import { GridLabels } from './GridLabels';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MapHud } from './MapHud';
import { Minimap } from './Minimap';
import { VehicleControl } from './VehicleControl';
import { VEHICLE_PANE, VehicleLayer } from './VehicleLayer';

export type BaseVariant = 'labels' | 'clean';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');
const tileUrl = (path: string) => `${tilesBase}/${path}/{z}/{y}/{x}.webp`;

/**
 * Client-only map (load with next/dynamic, ssr: false). PUBG maps: both base variants stay
 * mounted and swap by opacity, so the labels toggle never flashes blank; the 819 px low-res art
 * sits underneath while tiles stream in. Custom maps (F20): the uploaded image over the same
 * square, its 512 px preview underneath while it loads; no labels, vehicles or zone presets.
 * Children and the overlay can read the board's map (scale) from `BoardMapContext`.
 */
export default function MapCanvas({
  map: info,
  children,
  overlay,
  onCursor,
  minimap = false,
}: {
  map: BoardMapInfo;
  /** board layers (elements, cursors…) rendered inside the Leaflet map */
  children?: ReactNode;
  /** DOM floating over the map, outside Leaflet (style bar, hints) */
  overlay?: ReactNode;
  /** world-unit pointer position over the map (null when it leaves) */
  onCursor?: (pt: Pt | null) => void;
  /** Phase 11: the collapsible minimap (never on phones) */
  minimap?: boolean;
}) {
  const phone = useBreakpoint() === 'phone';
  const { config, worldSize, gridCells, maxNativeZoom, mapId, tileWorld } = info;
  const custom = info.kind === 'custom';
  const crs = useMemo(() => createCrs(config), [config]);
  const bounds = useMemo(() => worldBounds(worldSize), [worldSize]);

  const [map, setMap] = useState<L.Map | null>(null);
  // read once per mount: Leaflet takes these options at creation only
  const [reducedMotion] = useState(prefersReducedMotion);

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
  const [vehicles, setVehicles] = useVehiclePrefs();
  // vehicle spawns are PUBG data: never on a custom map
  const spawnData = useSpawnData(
    info.kind === 'pubg' ? info.mapId : 'erangel',
    vehicles.on && !custom,
  );

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
      if (action?.kind === 'labels' && !custom) toggleLabels();
      else if (action?.kind === 'grid') toggleGrid();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggleLabels, toggleGrid, custom]);

  const tileOptions = {
    tileSize: config.tileSize,
    noWrap: true,
    bounds,
    minNativeZoom: 0,
    maxNativeZoom,
    keepBuffer: 4,
    // CORS-clean tiles so a PNG export can read the canvas (FEATURES F12; DEPLOYMENT: R2 CORS)
    crossOrigin: 'anonymous',
  } as const;

  return (
    <BoardMapContext.Provider value={info}>
      <div
        data-testid="map-canvas"
        data-map={mapId}
        data-variant={variant}
        data-grid={grid ? 'on' : 'off'}
        data-vehicles={vehicles.on && !custom ? 'on' : 'off'}
        data-center={view.center}
        data-zoom={view.zoom}
        className="relative isolate h-full w-full overflow-hidden bg-bg"
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
            // reduced motion: no zoom / fade / marker-zoom animations (UI_UX_SPEC §2.4)
            zoomAnimation={!reducedMotion}
            fadeAnimation={!reducedMotion}
            markerZoomAnimation={!reducedMotion}
            className="h-full w-full !bg-bg"
            aria-label={`${config.name} map`}
          >
            <Pane name="placeholder" style={{ zIndex: 150 }}>
              <ImageOverlay
                crossOrigin="anonymous"
                url={info.backgroundUrl}
                bounds={bounds}
                pane="placeholder"
              />
            </Pane>
            {info.kind === 'custom' ? (
              <ImageOverlay
                crossOrigin="anonymous"
                url={info.imageUrl}
                bounds={bounds}
                className="custom-map-image"
                zIndex={2}
              />
            ) : (
              <>
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
              </>
            )}
            {/* between tiles (200) and future drawing overlays (400) */}
            <Pane name={GRID_PANE} style={{ zIndex: 350 }}>
              {grid && (
                <GridLayer worldSize={worldSize} cells={gridCells} maxNativeZoom={maxNativeZoom} />
              )}
            </Pane>
            {/* vehicle spawns: above the grid, below drawings (400) */}
            <Pane name={VEHICLE_PANE} style={{ zIndex: 360 }}>
              {vehicles.on && !custom && spawnData.status === 'ready' && (
                <VehicleLayer
                  spawns={spawnData.file.spawns}
                  kinds={vehicles.kinds}
                  tileWorld={tileWorld}
                />
              )}
            </Pane>
            {children}
          </MapContainer>
        </div>
        {map && grid && <GridLabels map={map} worldSize={worldSize} cells={gridCells} />}
        {overlay}
        {map && minimap && !phone && <Minimap map={map} info={info} />}
        {map && (
          <MapHud
            map={map}
            worldSize={worldSize}
            labels={variant === 'labels'}
            grid={grid}
            onToggleLabels={custom ? undefined : toggleLabels}
            onToggleGrid={toggleGrid}
            onFit={fit}
            vehicles={
              custom ? undefined : (
                <VehicleControl prefs={vehicles} onChange={setVehicles} data={spawnData} />
              )
            }
          />
        )}
      </div>
    </BoardMapContext.Provider>
  );
}
