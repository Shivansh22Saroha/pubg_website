'use client';

import type { MapConfig } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { clientToWorld, toLatLng } from '@/lib/coords';
import { useFollowStore } from '@/stores/followStore';
import { usePulseStore } from '@/stores/pulseStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export const PULSE_PANE = 'pulses';
const FLY_SECONDS = 0.3; // UI_UX_SPEC §5

/** the latest focus request already flown to (survives the map remounting on a board switch) */
let handledFocus = 0;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Map pings (FEATURES F9, UI_UX_SPEC §5):
 * - 📍 pick mode (crosshair, Esc cancels) or Alt+click anywhere attaches a ping to the chat input;
 *   both run in the capture phase so no tool sees that click;
 * - a ping chip's focus request flies here (300 ms) and plays a 3-pulse ring;
 * - pulses of freshly sent pings on this board (3 s). Reduced motion: instant jump, no animation.
 */
export function PingLayer({ config, boardId }: { config: MapConfig; boardId: string }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const ws = useWorkspaceStore.getState;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (!ws().pingPick && !e.altKey)) return;
      if (e.target instanceof Element && e.target.closest('[data-rl-overlay]')) return;
      e.preventDefault(); // no Leaflet drag, no tool
      e.stopPropagation();
      const [x, y] = clientToWorld(map, e, config.worldSize);
      ws().attachPing({ boardId, x, y });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ws().pingPick) {
        e.stopPropagation();
        ws().setPingPick(false);
      }
    };
    const syncCursor = () => {
      container.classList.toggle('rl-ping-pick', ws().pingPick);
    };
    container.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    syncCursor();
    const offWs = useWorkspaceStore.subscribe((s, prev) => {
      if (s.pingPick !== prev.pingPick) syncCursor();
      if (s.focusRequest !== prev.focusRequest) focus();
    });

    // ---- fly to a ping ---------------------------------------------------------------------
    const focus = () => {
      const req = ws().focusRequest;
      if (!req || req.boardId !== boardId || req.n === handledFocus) return;
      handledFocus = req.n;
      useFollowStore.getState().dispatch({ type: 'manualMove' }); // looking elsewhere
      const target = toLatLng([req.x, req.y]);
      const zoom = Math.max(map.getZoom(), config.maxNativeZoom - 1);
      if (prefersReducedMotion()) {
        map.setView(target, zoom, { animate: false });
        return;
      }
      map.once('moveend', () => {
        usePulseStore.getState().add({ boardId, x: req.x, y: req.y, kind: 'focus' });
      });
      map.flyTo(target, zoom, { duration: FLY_SECONDS });
    };
    focus(); // a request made before this board's map existed

    // ---- pulses ----------------------------------------------------------------------------
    if (!map.getPane(PULSE_PANE)) map.createPane(PULSE_PANE).style.zIndex = '630';
    const shown = new Map<number, L.Marker>();
    const render = () => {
      const pulses = usePulseStore.getState().pulses.filter((p) => p.boardId === boardId);
      const live = new Set(pulses.map((p) => p.id));
      for (const [id, m] of shown) {
        if (!live.has(id)) {
          m.remove();
          shown.delete(id);
        }
      }
      for (const p of pulses) {
        if (shown.has(p.id)) continue;
        const el = document.createElement('div');
        el.className = `rl-pulse rl-pulse-${p.kind}`;
        el.dataset.testid = 'map-pulse';
        el.append(document.createElement('span'), document.createElement('span'));
        shown.set(
          p.id,
          L.marker(toLatLng([p.x, p.y]), {
            icon: L.divIcon({ html: el, className: 'rl-pulse-icon', iconSize: [0, 0] }),
            interactive: false,
            keyboard: false,
            pane: PULSE_PANE,
          }).addTo(map),
        );
      }
    };
    render();
    const offPulse = usePulseStore.subscribe(render);
    const prune = setInterval(() => {
      usePulseStore.getState().prune();
    }, 250);

    return () => {
      container.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      container.classList.remove('rl-ping-pick');
      offWs();
      offPulse();
      clearInterval(prune);
      for (const m of shown.values()) m.remove();
    };
  }, [map, config, boardId]);

  return null;
}
