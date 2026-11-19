'use client';

import { GRID_COLUMN_LETTERS, GRID_ROW_LETTERS, type Layer } from '@rotationlab/shared';
import L from 'leaflet';
import { env } from '@/env';
import type { BoardMapInfo } from '@/lib/boardMap';
import { createCrs, toLatLng } from '@/lib/coords';
import {
  collectExportSources,
  EXPORT_SCALE,
  exportGridLabels,
  exportTileZoom,
  exportTiles,
  renderExport,
  worldToExportRect,
  type ExportSources,
  type WorldRect,
} from '@/lib/exportPng';
import type { ViewElement } from '@/stores/boardModel';
import { ELEMENTS_PANE, ICON_BASE, textScale } from './ElementLayer';
import { ElementRenderer } from './elementRenderer';
import { GRID_PANE, gridLineGroups, minorGridMinZoom } from './GridLayer';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');
const IMAGE_TIMEOUT_MS = 20_000;

/**
 * A canvas renderer that always draws at 2× (Leaflet uses 2× only on retina screens), so the
 * drawings in an export are as sharp as the map on every screen.
 */
const SharpCanvas = L.Canvas.extend({
  _update(this: L.Canvas) {
    const browser = L.Browser as { retina: boolean };
    const retina = browser.retina;
    browser.retina = true;
    try {
      (L.Canvas.prototype as unknown as { _update: () => void })._update.call(this);
    } finally {
      browser.retina = retina;
    }
  },
}) as unknown as new (options: L.RendererOptions) => L.Canvas;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // CORS-clean, or the export canvas is tainted
    img.decoding = 'async';
    const timer = setTimeout(() => {
      resolve(null);
    }, IMAGE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) resolve();
      else
        requestAnimationFrame(() => {
          step(left - 1);
        });
    };
    step(n);
  });

export interface BoardExportRequest {
  info: BoardMapInfo;
  elements: Record<string, ViewElement>;
  layers: Layer[];
  variant: 'labels' | 'clean';
  grid: boolean;
  /** the world area to export (its aspect is `cssWidth : cssHeight`) */
  rect: WorldRect;
  cssWidth: number;
  cssHeight: number;
  footer: string;
}

/**
 * Renders a board export (FEATURES F12) on a hidden Leaflet map of exactly the export size:
 * the map art loaded fresh at the resolution the export needs (deepest tiles, or the full
 * custom image), the grid and the drawings re-drawn at 2×, then composited by `renderExport`.
 * Works for the current view and for the whole map, whatever is on screen.
 */
export async function renderBoardExport(req: BoardExportRequest): Promise<Blob> {
  const { info, rect, cssWidth, cssHeight } = req;
  const scale = EXPORT_SCALE;
  const k = cssWidth / (rect.x1 - rect.x0); // CSS px per world unit

  // 1. the map art, at the export's resolution
  const images: ExportSources['images'] = [];
  const full: WorldRect = { x0: 0, y0: 0, x1: info.worldSize, y1: info.worldSize };
  const base = await loadImage(info.backgroundUrl);
  if (base) images.push({ ...worldToExportRect(full, rect, cssWidth, scale), img: base });
  if (info.kind === 'custom') {
    const img = await loadImage(info.imageUrl);
    if (img) images.push({ ...worldToExportRect(full, rect, cssWidth, scale), img });
  } else {
    const z = exportTileZoom(k * scale, info.tileWorld, info.maxNativeZoom);
    const path = info.config.variants[req.variant];
    const tiles = exportTiles(rect, info.worldSize, info.tileWorld, z);
    const loaded = await Promise.all(
      tiles.map((t) => loadImage(`${tilesBase}/${path}/${t.z}/${t.y}/${t.x}.webp`)),
    );
    tiles.forEach((t, i) => {
      const img = loaded[i];
      if (img) images.push({ ...worldToExportRect(t.world, rect, cssWidth, scale), img });
    });
  }

  // 2. grid + drawings on a hidden map of the export size
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${cssWidth}px`,
    height: `${cssHeight}px`,
    pointerEvents: 'none',
  });
  document.body.append(host);
  const zoom = Math.log2((k * info.tileWorld) / 256);
  const map = L.map(host, {
    crs: createCrs(info.config),
    zoomControl: false,
    attributionControl: false,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    zoomSnap: 0,
    minZoom: -10,
    maxZoom: 20,
  });
  let renderer: ElementRenderer | null = null;
  try {
    map.setView(toLatLng([(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2]), zoom, {
      animate: false,
    });
    if (req.grid) {
      map.createPane(GRID_PANE).style.zIndex = '350';
      const gridCanvas = new SharpCanvas({ pane: GRID_PANE, padding: 0 });
      const { major, minor } = gridLineGroups(info.worldSize, info.gridCells, gridCanvas);
      major.addTo(map);
      if (zoom >= minorGridMinZoom(info.maxNativeZoom)) minor.addTo(map);
    }
    map.createPane(ELEMENTS_PANE).style.zIndex = '400';
    host.style.setProperty('--rl-text-scale', String(textScale(zoom, info.maxNativeZoom)));
    const canvas = new SharpCanvas({ pane: ELEMENTS_PANE, padding: 0 });
    renderer = new ElementRenderer(L, map, canvas, info.tileWorld, ICON_BASE);
    renderer.sync(req.elements, req.layers);
    // the canvas renderers draw on the next animation frame; loot icons load on their own
    await frames(2);
    await Promise.all(
      [...host.querySelectorAll<HTMLImageElement>('img')]
        .filter((img) => !img.complete)
        .map((img) => img.decode().catch(() => undefined)),
    );

    const sources = await collectExportSources(host, {
      variant: req.variant,
      gridOn: req.grid,
      footer: req.footer,
      dpr: scale,
    });
    return await renderExport({
      ...sources,
      width: cssWidth,
      height: cssHeight,
      images,
      gridLabels: req.grid
        ? exportGridLabels(
            rect,
            cssWidth,
            cssHeight,
            info.worldSize,
            info.gridCells,
            GRID_COLUMN_LETTERS,
            GRID_ROW_LETTERS,
          )
        : [],
    });
  } finally {
    renderer?.destroy();
    map.remove();
    host.remove();
  }
}
