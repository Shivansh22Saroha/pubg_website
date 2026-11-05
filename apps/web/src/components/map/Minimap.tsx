'use client';

import { MAPS, type MapId } from '@rotationlab/shared';
import L from 'leaflet';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { env } from '@/env';
import { keyPan, MINIMAP_PX, minimapToWorld, viewportRect, type PxRect } from '@/lib/minimap';
import { prefKeys, readPref, writePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import { MANUAL_VIEW_EVENT } from './FollowController';

const tilesBase = env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '');

/**
 * Minimap (Phase 11, MAP-5, UI_UX_SPEC §3.5): bottom-right, 160×160, collapsible — the map's
 * low-res image with the main view's rectangle. Click or drag on it to move the view (a manual
 * move: it ends follow mode); arrow keys pan while it has focus. Not rendered on phones.
 */
export function Minimap({ map, mapId }: { map: L.Map; mapId: MapId }) {
  const config = MAPS[mapId];
  // the low-res art spans the world square, like MapCanvas's placeholder ImageOverlay
  const span = config.worldSize;
  const [rect, setRect] = useState<PxRect | null>(null);
  const [collapsed, setCollapsed] = useState(() => readPref(prefKeys.minimapCollapsed) === '1');
  const surface = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // LatLng == world units (lat = y, lng = x); y grows downward in this CRS, so Leaflet's
        // "north" is the larger y — take min / max rather than trusting the names
        const b = map.getBounds();
        const ys = [b.getNorth(), b.getSouth()];
        setRect(
          viewportRect(
            {
              minX: b.getWest(),
              minY: Math.min(...ys),
              maxX: b.getEast(),
              maxY: Math.max(...ys),
            },
            span,
          ),
        );
      });
    };
    update();
    map.on('move zoom resize', update);
    return () => {
      cancelAnimationFrame(frame);
      map.off('move zoom resize', update);
    };
  }, [map, span]);

  useEffect(() => {
    const el = surface.current?.parentElement;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  const moveTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const [x, y] = minimapToWorld(
      e.clientX - box.left,
      e.clientY - box.top,
      config.worldSize,
      span,
      box.width,
    );
    window.dispatchEvent(new Event(MANUAL_VIEW_EVENT));
    map.panTo([y, x], { animate: false });
  };

  const toggle = () => {
    setCollapsed((c) => {
      writePref(prefKeys.minimapCollapsed, c ? '0' : '1');
      return !c;
    });
  };

  return (
    <div
      data-testid="minimap"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="pointer-events-auto absolute right-3 bottom-16 z-20 glass overflow-hidden rounded-panel"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls="rl-minimap-surface"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text"
      >
        Minimap
        {collapsed ? (
          <ChevronUp className="size-3.5" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5" aria-hidden />
        )}
      </button>
      {!collapsed && (
        <div
          id="rl-minimap-surface"
          ref={surface}
          role="slider"
          tabIndex={0}
          aria-label="Minimap: click, drag or use the arrow keys to move the view"
          aria-valuetext={
            rect ? `View at ${Math.round(rect.left)}, ${Math.round(rect.top)} of ${MINIMAP_PX}` : ''
          }
          data-testid="minimap-surface"
          className="relative cursor-crosshair touch-none select-none focus-visible:outline-2 focus-visible:outline-accent"
          style={{ width: MINIMAP_PX, height: MINIMAP_PX }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            moveTo(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current) moveTo(e);
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={(e) => {
            const d = keyPan(e.key, config.worldSize);
            if (!d) return;
            e.preventDefault();
            e.stopPropagation(); // not the map's own arrow-key pan as well
            window.dispatchEvent(new Event(MANUAL_VIEW_EVENT));
            const c = map.getCenter();
            map.panTo([c.lat + d[1], c.lng + d[0]], { animate: false });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static tile asset */}
          <img
            src={`${tilesBase}/${config.lowres}`}
            alt=""
            draggable={false}
            className="pointer-events-none size-full"
          />
          {rect && (
            <div
              data-testid="minimap-viewport"
              className={cn('pointer-events-none absolute border-2 border-accent bg-accent/15')}
              style={{
                left: rect.left,
                top: rect.top,
                width: Math.max(4, rect.width),
                height: Math.max(4, rect.height),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
