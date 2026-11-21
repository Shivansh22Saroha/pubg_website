import { routesOf, type RouteOption } from '@/lib/plans';
import { useBoardStore } from '@/stores/boardStore';
import { usePlanStore } from '@/stores/planStore';
import { useSelectionStore } from '@/stores/selectionStore';

/**
 * The focused route with the board's current data, or null (gone, hidden, or none picked).
 * Leaflet-free, so the compass box can use it during server rendering too.
 */
export function focusedRoute(): RouteOption | null {
  const { focusRouteId, metresPerUnit } = usePlanStore.getState();
  if (!focusRouteId) return null;
  const { view } = useBoardStore.getState();
  if (!(focusRouteId in view.elements)) return null;
  return (
    routesOf(
      view.elements,
      view.layers,
      metresPerUnit,
      useSelectionStore.getState().hiddenLayers,
    ).find((r) => r.id === focusRouteId) ?? null
  );
}
