import { MAPS, tileWorldSize, type Pt } from '@rotationlab/shared';
import L from 'leaflet';
import { describe, expect, it } from 'vitest';
import { createCrs, fromLatLng, toLatLng, worldBounds } from '@/lib/coords';

const erangel = MAPS.erangel;
const W = erangel.worldSize;

describe('Leaflet CRS (ARCHITECTURE §5.3)', () => {
  const crs = createCrs(erangel);

  it('maps world (0,0) to pixel (0,0) and (W,W) to 256·2^z at every zoom', () => {
    for (const z of [0, 2, 5]) {
      expect(crs.latLngToPoint(toLatLng([0, 0]), z)).toEqual(L.point(0, 0));
      const far = crs.latLngToPoint(toLatLng([W, W]), z);
      expect(far.x).toBeCloseTo(256 * 2 ** z);
      expect(far.y).toBeCloseTo(256 * 2 ** z);
    }
  });

  it('keeps y growing downward (south)', () => {
    const north = crs.latLngToPoint(toLatLng([0, 100_000]), 0);
    const south = crs.latLngToPoint(toLatLng([0, 700_000]), 0);
    expect(south.y).toBeGreaterThan(north.y);
  });

  it('matches the native tile pyramid: one source pixel per CSS pixel at maxNativeZoom', () => {
    const px = crs.latLngToPoint(toLatLng([W, 0]), erangel.maxNativeZoom).x;
    expect(px).toBeCloseTo(erangel.sourceSize);
  });

  it('round-trips world → LatLng → pixel → LatLng → world', () => {
    const samples: Pt[] = [
      [0, 0],
      [123_456, 654_321],
      [W, W],
      [408_000, 1],
    ];
    for (const pt of samples) {
      for (const z of [-1, 0, 3.5, 7]) {
        const back = fromLatLng(crs.pointToLatLng(crs.latLngToPoint(toLatLng(pt), z), z));
        expect(back[0]).toBeCloseTo(pt[0], 6);
        expect(back[1]).toBeCloseTo(pt[1], 6);
      }
    }
  });

  it('accounts for padding when the art is not a power-of-two multiple of 256', () => {
    const padded = { ...erangel, sourceSize: 6000, paddedSize: 8192, maxNativeZoom: 5 };
    const crsPadded = createCrs(padded);
    // the real map edge (W) lands on source pixel 6000 at native zoom, not 8192
    expect(crsPadded.latLngToPoint(toLatLng([W, W]), 5).x).toBeCloseTo(6000);
    expect(tileWorldSize(padded)).toBeGreaterThan(W);
  });

  it('builds world bounds from (0,0) to (W,W)', () => {
    const b = worldBounds(W);
    expect(fromLatLng(b.getSouthWest())).toEqual([0, 0]);
    expect(fromLatLng(b.getNorthEast())).toEqual([W, W]);
  });
});
