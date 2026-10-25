import { describe, expect, it } from 'vitest';
import {
  can,
  CreateRoomBodySchema,
  formatInviteCode,
  InviteCodeSchema,
  minRole,
  normalizeInviteCode,
  PERMISSIONS,
  roleAtLeast,
  ROOM_ROLES,
  type Permission,
  type RoomRole,
} from '../src/index.js';

/** SECURITY §3 Z3, row by row. ✓ = allowed. */
const MATRIX: Record<Permission, Record<RoomRole, boolean>> = {
  'room.view': { OWNER: true, EDITOR: true, VIEWER: true },
  'room.interact': { OWNER: true, EDITOR: true, VIEWER: true },
  'board.edit': { OWNER: true, EDITOR: true, VIEWER: false },
  'layer.lock': { OWNER: true, EDITOR: false, VIEWER: false },
  'board.manage': { OWNER: true, EDITOR: true, VIEWER: false },
  'board.delete': { OWNER: true, EDITOR: false, VIEWER: false },
  'invite.create': { OWNER: true, EDITOR: true, VIEWER: false },
  'room.manage': { OWNER: true, EDITOR: false, VIEWER: false },
  'chat.deleteAny': { OWNER: true, EDITOR: false, VIEWER: false },
};

describe('permission matrix (SECURITY §3)', () => {
  it('covers exactly the documented permissions', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [permission, row] of Object.entries(MATRIX) as [
    Permission,
    Record<RoomRole, boolean>,
  ][]) {
    for (const role of ROOM_ROLES) {
      it(`${role} ${row[role] ? 'can' : 'cannot'} ${permission}`, () => {
        expect(can(role, permission)).toBe(row[role]);
      });
    }
  }

  it('non-members can do nothing', () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it('orders roles VIEWER < EDITOR < OWNER', () => {
    expect(roleAtLeast('OWNER', 'EDITOR')).toBe(true);
    expect(roleAtLeast('EDITOR', 'EDITOR')).toBe(true);
    expect(roleAtLeast('VIEWER', 'EDITOR')).toBe(false);
    expect(minRole('EDITOR', 'VIEWER')).toBe('VIEWER');
    expect(minRole('VIEWER', 'OWNER')).toBe('VIEWER');
    expect(minRole('EDITOR', 'OWNER')).toBe('EDITOR');
  });
});

describe('invite codes', () => {
  it('normalises dashes, spaces, case and Crockford look-alikes', () => {
    expect(normalizeInviteCode('7kq2-m9xf-ap')).toBe('7KQ2M9XFAP');
    expect(normalizeInviteCode(' 7KQ2 M9XF AP ')).toBe('7KQ2M9XFAP');
    expect(normalizeInviteCode('O1LI')).toBe('0111');
  });

  it('validates through the schema', () => {
    expect(InviteCodeSchema.parse('7kq2-m9xf-ap')).toBe('7KQ2M9XFAP');
    expect(InviteCodeSchema.safeParse('7KQ2M9XFA').success).toBe(false); // 9 chars
    expect(InviteCodeSchema.safeParse('7KQ2M9XFAU').success).toBe(false); // U not in alphabet
    expect(InviteCodeSchema.safeParse('<script>xx').success).toBe(false);
  });

  it('formats for display', () => {
    expect(formatInviteCode('7KQ2M9XFAP')).toBe('7KQ2-M9XF-AP');
  });
});

describe('CreateRoomBodySchema', () => {
  const base = { name: 'Team Soul', firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' } };
  it('accepts the minimal body and rejects bad maps, roles and passwords', () => {
    expect(CreateRoomBodySchema.safeParse(base).success).toBe(true);
    expect(CreateRoomBodySchema.safeParse({ ...base, password: 'abc' }).success).toBe(false);
    expect(CreateRoomBodySchema.safeParse({ ...base, password: null }).success).toBe(true);
    expect(CreateRoomBodySchema.safeParse({ ...base, defaultRole: 'OWNER' }).success).toBe(false);
    expect(
      CreateRoomBodySchema.safeParse({ ...base, firstBoard: { name: 'x', mapId: 'vikendi' } })
        .success,
    ).toBe(false);
  });
});
