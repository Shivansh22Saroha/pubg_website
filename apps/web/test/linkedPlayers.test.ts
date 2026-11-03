import type { Member } from '@rotationlab/shared';
import { describe, expect, it } from 'vitest';
import { elementLabel } from '@/components/tools/ElementList';
import { linkedLabel, withPlayerLabels } from '@/lib/linkedPlayers';
import type { ViewElement } from '@/stores/boardModel';
import { playersFrom } from '@/stores/playersStore';

const el = (id: string, props: Record<string, unknown>, type: ViewElement['type'] = 'MARKER') =>
  ({
    id,
    boardId: 'b',
    layerId: 'l',
    type,
    geometry: { at: [1, 1] },
    style: { color: '#38BDF8', width: 4, dashed: false, fillOpacity: 0 },
    props,
    z: 0,
    seq: 1,
    createdBy: null,
    updatedBy: null,
    updatedAt: '2026-11-03T00:00:00.000Z',
  }) as ViewElement;

describe('linked own-player markers (Phase 12)', () => {
  it('players: IGN, else display name', () => {
    const member = (id: string, displayName: string, ign: string | null) =>
      ({ user: { id, displayName, ign, username: id, avatarColor: '#38BDF8' } }) as Member;
    expect(playersFrom([member('a', 'Alice', 'xAlice'), member('b', 'Bob', null)])).toEqual([
      { id: 'a', label: 'xAlice', displayName: 'Alice' },
      { id: 'b', label: 'Bob', displayName: 'Bob' },
    ]);
  });

  it('a linked marker is labelled with its member; a former member gives no label', () => {
    const names = { a: 'xAlice' };
    expect(linkedLabel(el('1', { kind: 'own_player', memberId: 'a' }), names)).toBe('xAlice');
    expect(linkedLabel(el('2', { kind: 'own_player', memberId: 'gone' }), names)).toBeUndefined();
    expect(elementLabel(el('3', { kind: 'own_player', number: 2, memberId: 'a' }), names)).toBe(
      'Own player 2 xAlice',
    );
  });

  it('keeps identity for everything unlinked and re-labels only on a name change', () => {
    const cache = new WeakMap();
    const plain = el('p', { kind: 'enemy_squad', number: 1, label: 'Bridge' });
    const linked = el('l', { kind: 'own_player', number: 1, memberId: 'a', label: 'stale' });
    const none = { p: plain };
    expect(withPlayerLabels(none, { a: 'x' }, cache)).toBe(none);

    const first = withPlayerLabels({ p: plain, l: linked }, { a: 'xAlice' }, cache);
    expect(first.p).toBe(plain);
    expect(first.l?.props.label).toBe('xAlice');
    const again = withPlayerLabels({ p: plain, l: linked }, { a: 'xAlice' }, cache);
    expect(again.l).toBe(first.l); // same name → same object, no re-render
    const renamed = withPlayerLabels({ p: plain, l: linked }, { a: 'Ace' }, cache);
    expect(renamed.l?.props.label).toBe('Ace');
    const left = withPlayerLabels({ l: linked }, {}, cache);
    expect(left.l?.props).not.toHaveProperty('label');
  });
});
