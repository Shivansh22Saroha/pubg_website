/**
 * Leaflet side of the coordinate system (ARCHITECTURE §5.3). A custom simple CRS makes
 * Leaflet LatLng == world units: lat = y (south), lng = x (east). Zoom 0 = the whole tile
 * pyramid in one 256 px tile. Import only from client-only modules (Leaflet touches `window`).
 */
import L from 'leaflet';
import { tileWorldSize, type MapConfig, type Pt } from '@rotationlab/shared';

export function createCrs(map: MapConfig): L.CRS {
  const T = tileWorldSize(map); // === worldSize unless the source art was padded
  return L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(256 / T, 0, 256 / T, 0), // y grows downward
  });
}

export function toLatLng([x, y]: Pt): L.LatLng {
  return L.latLng(y, x);
}

export function fromLatLng(ll: L.LatLngLiteral): Pt {
  return [ll.lng, ll.lat];
}

export function worldBounds(worldSize: number): L.LatLngBounds {
  return L.latLngBounds([0, 0], [worldSize, worldSize]);
}
