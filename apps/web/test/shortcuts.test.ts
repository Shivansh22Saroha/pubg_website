import type { Layer } from '@rotationlab/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { layerPermissions, toolsForRole } from '@/components/tools/gating';
import { BATCH_MAX_OPS, planSends } from '@/lib/realtime/batching';
import { resolveShortcut, shortcutHelp, type KeyLike } from '@/lib/shortcuts';
import type { PendingOp } from '@/stores/boardModel';

const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target: document.body,
  ...over,
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('resolveShortcut (UI_UX_SPEC §8)', () => {
  it('tool letters, case-insensitive', () => {
    expect(resolveShortcut(key('v'), false)).toEqual({ kind: 'tool', tool: 'select' });
    expect(resolveShortcut(key('E'), false)).toEqual({ kind: 'tool', tool: 'eraser' });
    expect(resolveShortcut(key('g'), false)).toEqual({ kind: 'tool', tool: 'polygon' });
  });

  it('undo / redo with Ctrl on Windows/Linux and Cmd on macOS', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true }), false)).toEqual({ kind: 'undo' });
    expect(resolveShortcut(key('Z', { ctrlKey: true, shiftKey: true }), false)).toEqual({
      kind: 'redo',
    });
    expect(resolveShortcut(key('y', { ctrlKey: true }), false)).toEqual({ kind: 'redo' });
    expect(resolveShortcut(key('z', { metaKey: true }), true)).toEqual({ kind: 'undo' });
    expect(resolveShortcut(key('z', { metaKey: true }), false)).toBeNull(); // Cmd off a Mac
    expect(resolveShortcut(key('z', { ctrlKey: true }), true)).toBeNull(); // Ctrl on a Mac
  });

  it('selection: Delete / Backspace, Ctrl+D, Ctrl+A, Esc, Enter', () => {
    expect(resolveShortcut(key('Delete'), false)).toEqual({ kind: 'delete' });
    expect(resolveShortcut(key('Backspace'), false)).toEqual({ kind: 'delete' });
    expect(resolveShortcut(key('d', { ctrlKey: true }), false)).toEqual({ kind: 'duplicate' });
    expect(resolveShortcut(key('a', { metaKey: true }), true)).toEqual({ kind: 'selectAll' });
    expect(resolveShortcut(key('Escape'), false)).toEqual({ kind: 'escape' });
    expect(resolveShortcut(key('Enter'), false)).toEqual({ kind: 'enter' });
  });

  it('map & room: Shift+G grid, N labels, 1–9 boards, ] panel, / chat, ? help', () => {
    expect(resolveShortcut(key('G', { shiftKey: true }), false)).toEqual({ kind: 'grid' });
    expect(resolveShortcut(key('n'), false)).toEqual({ kind: 'labels' });
    expect(resolveShortcut(key('3'), false)).toEqual({ kind: 'board', index: 2 });
    expect(resolveShortcut(key('0'), false)).toBeNull();
    expect(resolveShortcut(key(']'), false)).toEqual({ kind: 'panel' });
    expect(resolveShortcut(key('/'), false)).toEqual({ kind: 'chat' });
    expect(resolveShortcut(key('?', { shiftKey: true }), false)).toEqual({ kind: 'help' });
    expect(resolveShortcut(key('P', { shiftKey: true }), false)).toBeNull();
    expect(resolveShortcut(key('v', { altKey: true }), false)).toBeNull();
  });

  it('every shortcut is off while focus is in an input, a textarea or a dialog', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inDialog = document.createElement('button');
    dialog.append(inDialog);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(input, area, dialog, editable);
    for (const target of [input, area, inDialog]) {
      expect(resolveShortcut(key('v', { target }), false)).toBeNull();
      expect(resolveShortcut(key('z', { ctrlKey: true, target }), false)).toBeNull();
      expect(resolveShortcut(key('Delete', { target }), false)).toBeNull();
      expect(resolveShortcut(key('?', { shiftKey: true, target }), false)).toBeNull();
    }
    expect(resolveShortcut(key('v', { target: document.body }), false)).not.toBeNull();
  });

  it('the help dialog lists every shortcut, with ⌘ on macOS', () => {
    const all = shortcutHelp(false).flatMap((g) => g.items.map(([k]) => k));
    for (const k of [
      'V',
      'E',
      'Ctrl Z',
      'Ctrl D',
      'Ctrl A',
      'Del / Backspace',
      'Esc',
      '?',
      ']',
      '/',
      '1 – 9',
      'Shift G',
      'N',
      'Space (hold)',
      'Enter',
    ])
      expect(all).toContain(k);
    expect(shortcutHelp(true).flatMap((g) => g.items.map(([k]) => k))).toContain('⌘ Z');
  });
});

describe('layer panel permissions (FEATURES F5, SECURITY §3)', () => {
  const unlocked = { locked: false } satisfies Pick<Layer, 'locked'>;
  const locked = { locked: true } satisfies Pick<Layer, 'locked'>;

  it('owner: everything; lock toggle is the owner’s only; locked layers can’t be cleared', () => {
    expect(layerPermissions('OWNER', unlocked, 3)).toEqual({
      toggleVisible: true,
      toggleLock: true,
      rename: true,
      recolor: true,
      delete: true,
      clear: true,
      reorder: true,
    });
    expect(layerPermissions('OWNER', locked, 3)).toMatchObject({
      toggleVisible: true,
      rename: true,
      delete: true,
      clear: false,
    });
  });

  it('editor: unlocked layers only, never the lock toggle', () => {
    expect(layerPermissions('EDITOR', unlocked, 3)).toMatchObject({
      toggleVisible: true,
      toggleLock: false,
      rename: true,
      delete: true,
      clear: true,
      reorder: true,
    });
    expect(layerPermissions('EDITOR', locked, 3)).toEqual({
      toggleVisible: false,
      toggleLock: false,
      rename: false,
      recolor: false,
      delete: false,
      clear: false,
      reorder: true,
    });
  });

  it('viewer: nothing board-wide (local hide is always allowed)', () => {
    expect(Object.values(layerPermissions('VIEWER', unlocked, 3)).some(Boolean)).toBe(false);
  });

  it('the last layer can’t be deleted', () => {
    expect(layerPermissions('OWNER', unlocked, 1).delete).toBe(false);
  });

  it('viewers see Select, Measure, Laser only', () => {
    expect(toolsForRole('VIEWER')).toEqual(['select', 'measure', 'laser']);
    expect(toolsForRole('EDITOR')).toContain('eraser');
  });
});

describe('batch chunking (≤ 50 ops per element:batch)', () => {
  const BOARD = '0192f7a1-0000-7000-8000-00000000000b';
  const del = (i: number, boardId = BOARD): PendingOp => ({
    opId: `op-${i}`,
    boardId,
    op: {
      kind: 'element:delete',
      elementId: `0192f7a1-0000-7000-8000-${String(i).padStart(12, '0')}`,
    },
  });

  it('120 element ops → 50 + 50 + 20, in order', () => {
    const list = Array.from({ length: 120 }, (_, i) => del(i));
    const chunks = planSends(list);
    expect(chunks.map((c) => c.length)).toEqual([BATCH_MAX_OPS, BATCH_MAX_OPS, 20]);
    expect(chunks.flat()).toEqual(list);
  });

  it('layer ops go alone and split element runs; another board starts a new chunk', () => {
    const layerOp: PendingOp = {
      opId: 'layer',
      boardId: BOARD,
      op: { kind: 'layer:clear', layerId: 'L' },
    };
    const other = '0192f7a1-0000-7000-8000-00000000000c';
    const chunks = planSends([del(1), del(2), layerOp, del(3), del(4, other)]);
    expect(chunks.map((c) => c.map((p) => p.opId))).toEqual([
      ['op-1', 'op-2'],
      ['layer'],
      ['op-3'],
      ['op-4'],
    ]);
  });
});
