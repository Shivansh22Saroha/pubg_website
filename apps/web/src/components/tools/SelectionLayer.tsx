'use client';

import { tileWorldSize, type BBox, type MapConfig, type Pt } from '@rotationlab/shared';
import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { textScale } from '@/components/map/ElementLayer';
import { safeColor } from '@/components/map/markerDom';
import { toLatLng, worldPerPx } from '@/lib/coords';
import { useBoardStore } from '@/stores/boardStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { displayBox, radiusHandle, withTransform, type Scene } from './scene';

export const SELECTION_PANE = 'selection';
/** outline padding around the selected element, screen px */
const PAD_PX = 4;
const HANDLE_HALF_PX = 3;
const DANGER = '#EF4444';

const corners = (b: BBox): [number, number][] => [
  [b.minY, b.minX],
  [b.minY, b.maxX],
  [b.maxY, b.maxX],
  [b.maxY, b.minX],
];

/**
 * Selection visuals (UI_UX_SPEC §6): a 1.5 px dashed outline in this user's presence colour
 * with corner handles — circles get a dashed ring and a round radius handle — plus the
 * Shift+drag marquee and the eraser's to-be-deleted highlight. Above markers, never
 * interactive (the tools hit-test in world units themselves).
 */
export function SelectionLayer({ config, meId }: { config: MapConfig; meId: string }) {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(SELECTION_PANE)) map.createPane(SELECTION_PANE).style.zIndex = '640';
    const renderer = L.svg({ pane: SELECTION_PANE, padding: 0.5 });
    const group = L.layerGroup().addTo(map);
    const tileWorld = tileWorldSize(config);

    const draw = () => {
      group.clearLayers();
      const sel = useSelectionStore.getState();
      const board = useBoardStore.getState();
      const k = worldPerPx(map, tileWorld);
      const scene: Scene = {
        elements: withTransform(board.view.elements, sel.transform),
        layers: board.view.layers,
        hidden: sel.hiddenLayers,
        worldPerPx: k,
        textScale: textScale(map.getZoom(), config.maxNativeZoom),
      };
      const color = safeColor(usePresenceStore.getState().users[meId]?.color, '#F2A900');
      const base: L.PathOptions = { renderer, pane: SELECTION_PANE, interactive: false };
      const outline: L.PathOptions = {
        ...base,
        color,
        weight: 1.5,
        dashArray: '4 3',
        fill: false,
        className: 'rl-selection',
      };
      const handle = (at: Pt, round: boolean) => {
        if (round) {
          L.circleMarker(toLatLng(at), {
            ...base,
            radius: 5,
            color,
            weight: 1.5,
            fillColor: '#F8FAFC',
            fillOpacity: 1,
            className: 'rl-radius-handle',
          }).addTo(group);
          return;
        }
        const h = HANDLE_HALF_PX * k;
        L.rectangle(
          [
            [at[1] - h, at[0] - h],
            [at[1] + h, at[0] + h],
          ],
          { ...base, color, weight: 1, fillColor: '#F8FAFC', fillOpacity: 1 },
        ).addTo(group);
      };

      for (const id of sel.ids) {
        const el = scene.elements[id];
        if (!el) continue;
        const g = el.geometry as { center?: Pt; r?: number };
        if (el.type === 'CIRCLE' && g.center) {
          L.circle(toLatLng(g.center), { ...outline, radius: (g.r ?? 0) + PAD_PX * k }).addTo(
            group,
          );
          const h = radiusHandle(el);
          if (h) handle(h, true);
          continue;
        }
        const box = displayBox(el, scene);
        if (!box) continue;
        const p = PAD_PX * k;
        const padded = {
          minX: box.minX - p,
          minY: box.minY - p,
          maxX: box.maxX + p,
          maxY: box.maxY + p,
        };
        L.polygon(corners(padded), outline).addTo(group);
        for (const [y, x] of corners(padded)) handle([x, y], false);
      }

      for (const id of sel.highlight) {
        const el = scene.elements[id];
        const box = el ? displayBox(el, scene) : null;
        if (!box) continue;
        const p = PAD_PX * k;
        L.polygon(
          corners({
            minX: box.minX - p,
            minY: box.minY - p,
            maxX: box.maxX + p,
            maxY: box.maxY + p,
          }),
          {
            ...base,
            color: DANGER,
            weight: 2,
            fillColor: DANGER,
            fillOpacity: 0.15,
            className: 'rl-erase-highlight',
          },
        ).addTo(group);
      }

      if (sel.marquee) {
        L.polygon(corners(sel.marquee), {
          ...base,
          color,
          weight: 1,
          dashArray: '4 3',
          fillColor: color,
          fillOpacity: 0.08,
          className: 'rl-marquee',
        }).addTo(group);
      }
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    schedule();
    const offSel = useSelectionStore.subscribe(schedule);
    const offBoard = useBoardStore.subscribe((s, prev) => {
      if (s.view !== prev.view && useSelectionStore.getState().ids.length > 0) schedule();
    });
    map.on('zoomend', schedule);
    return () => {
      cancelAnimationFrame(frame);
      offSel();
      offBoard();
      map.off('zoomend', schedule);
      group.remove();
      renderer.remove();
    };
  }, [map, config, meId]);

  return null;
}
