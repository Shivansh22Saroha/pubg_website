'use client';

import { MAPS, tileWorldSize, type MapId } from '@rotationlab/shared';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import MapCanvas from '@/components/map/MapCanvas';
import { StaticElements } from '@/components/map/StaticElements';
import { MeasureLayer } from '@/components/tools/MeasureLayer';
import { MeasureTool } from '@/components/tools/tools';
import type { ToolContext } from '@/components/tools/types';
import { clientToWorld, worldPerPx } from '@/lib/coords';
import { shortcutsBlocked } from '@/lib/shortcuts';
import type { ExploreBoard } from '@/lib/explore';
import { useMeasureStore } from '@/stores/measureStore';

/**
 * The measure tool on a read-only map (UF-9): the same MeasureTool state machine as the room,
 * given only what it uses (pixel scale + the local measure line). While measuring, a press
 * adds a point instead of panning; two fingers still pan / pinch.
 */
function ExploreMeasure({ mapId, active }: { mapId: MapId; active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const config = MAPS[mapId];
    const tileWorld = tileWorldSize(config);
    const ctx = {
      worldPerPx: () => worldPerPx(map, tileWorld),
      setMeasure: (line) => {
        useMeasureStore.setState({ line });
      },
    } satisfies Pick<ToolContext, 'worldPerPx' | 'setMeasure'>;
    // MeasureTool only touches these two (it overrides cancel)
    const tool = new MeasureTool(ctx as ToolContext);
    const container = map.getContainer();
    const touches = new Set<number>();
    const pointer = (e: PointerEvent | MouseEvent) => ({
      world: clientToWorld(map, e, config.worldSize),
      screen: [e.clientX, e.clientY] as [number, number],
      shiftKey: e.shiftKey,
      button: e.button,
    });
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.add(e.pointerId);
        if (touches.size > 1) return; // second finger: Leaflet pinches
      }
      if (e.button !== 0) return;
      e.preventDefault();
      tool.onPointerDown(pointer(e));
    };
    const move = (e: PointerEvent) => {
      if (touches.size > 1) return;
      tool.onPointerMove(pointer(e));
    };
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId);
    };
    const dbl = (e: MouseEvent) => {
      e.stopPropagation();
      tool.onDoubleClick();
    };
    const key = (e: KeyboardEvent) => {
      if (shortcutsBlocked(e.target)) return;
      if (tool.onKeyDown({ key: e.key, shiftKey: e.shiftKey })) e.preventDefault();
    };
    map.dragging.disable();
    map.doubleClickZoom.disable();
    container.classList.add('rl-drawing');
    container.style.cursor = 'crosshair';
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);
    container.addEventListener('dblclick', dbl, true);
    window.addEventListener('keydown', key);
    return () => {
      tool.cancel();
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.classList.remove('rl-drawing');
      container.style.cursor = '';
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', up);
      container.removeEventListener('pointercancel', up);
      container.removeEventListener('dblclick', dbl, true);
      window.removeEventListener('keydown', key);
    };
  }, [map, mapId, active]);
  return null;
}

/** A demo board, read-only: tiles, grid, labels, its elements and the local measure line. */
export default function ExploreMap({
  board,
  measuring,
}: {
  board: ExploreBoard;
  measuring: boolean;
}) {
  return (
    <MapCanvas mapId={board.mapId}>
      <StaticElements mapId={board.mapId} elements={board.elements} layers={board.layers} />
      <MeasureLayer />
      <ExploreMeasure mapId={board.mapId} active={measuring} />
    </MapCanvas>
  );
}
