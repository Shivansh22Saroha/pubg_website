import { describe, expect, it } from 'vitest';
import { describeTelemetry, firstRides, recallUses } from '../scripts/telemetry.js';

const ride = (
  uid: number | string | undefined,
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

  it('skips non-fixed vehicles and malformed events', () => {
    const events = [
      ride(4, 1, 1, 'BP_BRDM_C'),
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

  it('accepts string vehicle ids', () => {
    expect(
      firstRides([ride('a1', 10, 20, 'Uaz_A_01_C'), ride('a1', 99, 99, 'Uaz_A_01_C')], 'm3'),
    ).toEqual([{ x: 10, y: 20, kind: 'car', matchId: 'm3' }]);
  });

  it('describes a telemetry file by shape only, never player names', () => {
    const d = describeTelemetry([{ _T: 'LogMatchStart' }, ride(1, 5, 5, 'Dacia_A_01_v2_C')]);
    expect(d).toContain('"LogVehicleRide":1');
    expect(d).toContain('vehicleUniqueId:number');
    expect(d).toContain('name:string');
    expect(d).not.toContain('"p"');
    expect(describeTelemetry({ a: 1 })).toBe('not an array: {a:number}');
  });

  describe('current telemetry (no vehicleUniqueId)', () => {
    const ev = (
      _T: 'LogVehicleRide' | 'LogVehicleLeave',
      x: number,
      y: number,
      vehicleId = 'Dacia_A_01_v2_C',
      healthPercent = 100,
    ) => ({
      _T,
      character: { name: 'p', location: { x: x + 80, y: y + 80, z: 100 } },
      vehicle: {
        vehicleType: 'WheeledVehicle',
        vehicleId,
        healthPercent,
        location: { x, y, z: 90 },
      },
    });

    it('takes the vehicle position of a first ride; squadmates and re-entries are skipped', () => {
      const events = [
        ev('LogVehicleRide', 100_000, 100_000), // first ride at its spawn
        ev('LogVehicleRide', 100_050, 100_020), // squadmate gets in: same vehicle
        ev('LogVehicleLeave', 300_000, 300_000), // driven away and left
        ev('LogVehicleRide', 300_100, 300_000), // re-entered where it was left
        ev('LogVehicleRide', 200_000, 200_000, 'BP_Motorbike_04_C'), // another vehicle
        ev('LogVehicleRide', 300_200, 300_100, 'BP_Motorbike_04_C'), // other model: own spawn
      ];
      expect(firstRides(events, 'm4')).toEqual([
        { x: 100_000, y: 100_000, kind: 'car', matchId: 'm4' },
        { x: 200_000, y: 200_000, kind: 'bike', matchId: 'm4' },
        { x: 300_200, y: 300_100, kind: 'bike', matchId: 'm4' },
      ]);
    });

    it('skips damaged vehicles (already used) and the transport plane', () => {
      expect(
        firstRides(
          [
            ev('LogVehicleRide', 1_000, 1_000, 'Uaz_A_01_C', 60),
            ev('LogVehicleRide', 5_000, 5_000, 'DummyTransportAircraft_C'),
          ],
          'm5',
        ),
      ).toEqual([]);
    });
  });
});

describe('recall towers from telemetry', () => {
  const use = (itemId: string, x: unknown, y: unknown, _T = 'LogItemUse') => ({
    _T,
    character: { name: 'p', location: { x, y, z: 3300 } },
    item: { itemId, category: 'Use' },
  });

  it('records every Blue Chip use at the player position, rounded', () => {
    expect(
      recallUses(
        [
          use('Item_Bluechip_C', 293_948.4, 448_577.6),
          use('Item_Heal_Bandage_C', 1, 1), // other items
          use('Item_Bluechip_C', 5, 5, 'LogItemPickup'), // picking a chip up isn't a use
          use('Item_Special_Bluechip_C', 6, 6, 'LogItemEquip'), // carrying one isn't either
          use('Item_Bluechip_C', 421_876, 442_410),
        ],
        'm1',
      ),
    ).toEqual([
      { x: 293_948, y: 448_578, matchId: 'm1' },
      { x: 421_876, y: 442_410, matchId: 'm1' },
    ]);
  });

  it('ignores malformed events', () => {
    expect(
      recallUses(
        [
          use('Item_Bluechip_C', 'a', 1),
          { _T: 'LogItemUse', item: { itemId: 'Item_Bluechip_C' } },
          null,
          7,
        ],
        'm2',
      ),
    ).toEqual([]);
    expect(recallUses('nope', 'm2')).toEqual([]);
  });
});
