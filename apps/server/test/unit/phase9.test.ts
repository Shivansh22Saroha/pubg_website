import { randomUUID } from 'node:crypto';
import { DEFAULT_LAYERS, MAP_IDS, MAPS } from '@rotationlab/shared';
import { describe, expect, it } from 'vitest';
import { demoElements } from '../../scripts/seedContent.js';
import { readPrefs } from '../../src/modules/auth/service.js';
import { testConfig } from '../helpers.js';

const A = '0192f7a1-0000-7000-8000-00000000000a';
const B = '0192f7a1-0000-7000-8000-00000000000b';

describe('DEMO_BOARD_IDS (FEATURES F13)', () => {
  it('unset or empty → no demo boards', () => {
    expect(testConfig().DEMO_BOARD_IDS).toEqual([]);
    expect(testConfig({ DEMO_BOARD_IDS: '' }).DEMO_BOARD_IDS).toEqual([]);
  });

  it('comma-separated uuids, trimmed, empty items dropped', () => {
    expect(testConfig({ DEMO_BOARD_IDS: ` ${A}, ,${B} ` }).DEMO_BOARD_IDS).toEqual([A, B]);
  });

  it('refuses non-uuids and more than one per map', () => {
    expect(() => testConfig({ DEMO_BOARD_IDS: 'not-a-uuid' })).toThrow();
    expect(() => testConfig({ DEMO_BOARD_IDS: [A, B, A, B].join(',') })).toThrow();
  });
});

describe('seed content (DATABASE_SCHEMA §7)', () => {
  it('every map gets a valid drop, route, zone circle and enemies inside the map', () => {
    for (const mapId of MAP_IDS) {
      const layers = DEFAULT_LAYERS.map((l) => ({ id: randomUUID(), name: l.name }));
      const idOf = (name: string) => layers.find((l) => l.name === name)!.id;
      const els = demoElements(mapId, layers, randomUUID, randomUUID());
      const kinds = els.map((e) =>
        e.type === 'MARKER' ? `MARKER:${(e.props as { kind: string }).kind}` : e.type,
      );
      expect(kinds).toEqual(
        expect.arrayContaining(['CIRCLE', 'ARROW', 'MARKER:drop', 'MARKER:enemy_squad', 'TEXT']),
      );
      expect(kinds.filter((k) => k === 'MARKER:enemy_squad')).toHaveLength(3);
      // enemies on the Enemies layer, the zone on Zones, the rest on Plan
      for (const e of els) {
        const layer =
          e.type === 'CIRCLE'
            ? 'Zones'
            : (e.props as { kind?: string }).kind === 'enemy_squad'
              ? 'Enemies'
              : 'Plan';
        expect(e.layerId).toBe(idOf(layer));
      }
      const circle = els.find((e) => e.type === 'CIRCLE')!.geometry as { r: number };
      expect(circle.r).toBeLessThan(MAPS[mapId].worldSize / 4);
    }
  });
});

describe('readPrefs', () => {
  it('defaults, keeps known keys, ignores anything else', () => {
    expect(readPrefs({})).toEqual({ roomTourDone: false });
    expect(readPrefs(null)).toEqual({ roomTourDone: false });
    expect(readPrefs({ roomTourDone: true, extra: 1 })).toEqual({ roomTourDone: true });
    expect(readPrefs({ roomTourDone: 'yes' })).toEqual({ roomTourDone: false });
    expect(readPrefs('garbage')).toEqual({ roomTourDone: false });
  });
});
