import { describe, expect, it } from 'vitest';
import { firstRides } from '../scripts/telemetry.js';

const ride = (
  uid: number | undefined,
  x: number,
  y: number,
  vehicleId?: string,
  vehicleType = 'WheeledVehicle',
) => ({
  _T: 'LogVehicleRide',
  character: { name: 'p', location: { x, y, z: 100 } },
  vehicle: { vehicleType, vehicleId, vehicleUniqueId: uid },
});

describe('first rides from telemetry', () => {
  it('records each vehicle once, at the spot it was first entered', () => {
    const events = [
      { _T: 'LogMatchStart' },
      ride(1, 100_000.4, 200_000.6, 'Dacia_A_01_v2_C'),
      ride(1, 400_000, 400_000, 'Dacia_A_01_v2_C'), // driven away and re-entered: ignored
      ride(2, 300_000, 310_000, 'Boat_PG117_C', 'FloatingVehicle'),
      ride(3, 50_000, 60_000, 'BP_Motorbike_04_C'),
    ];
    expect(firstRides(events, 'm1')).toEqual([
      { x: 100_000, y: 200_001, kind: 'car', matchId: 'm1' },
      { x: 300_000, y: 310_000, kind: 'boat', matchId: 'm1' },
      { x: 50_000, y: 60_000, kind: 'bike', matchId: 'm1' },
    ]);
  });

  it('skips non-fixed vehicles, rides it cannot tell apart, and malformed events', () => {
    const events = [
      ride(4, 1, 1, 'BP_BRDM_C'),
      ride(undefined, 2, 2, 'Dacia_A_01_v2_C'),
      { _T: 'LogVehicleRide', vehicle: { vehicleId: 'Uaz_A_01_C', vehicleUniqueId: 5 } },
      {
        _T: 'LogVehicleRide',
        character: { location: { x: 'a', y: 1 } },
        vehicle: { vehicleUniqueId: 6, vehicleId: 'Uaz_A_01_C' },
      },
      null,
      'nope',
    ];
    expect(firstRides(events, 'm1')).toEqual([]);
    expect(firstRides({ not: 'an array' }, 'm1')).toEqual([]);
  });

  it('a floating vehicle without a model name is a boat', () => {
    expect(firstRides([ride(7, 10, 20, undefined, 'FloatingVehicle')], 'm2')).toEqual([
      { x: 10, y: 20, kind: 'boat', matchId: 'm2' },
    ]);
  });
});
