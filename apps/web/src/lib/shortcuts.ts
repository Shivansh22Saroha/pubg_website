/**
 * Keyboard shortcuts (UI_UX_SPEC §8) — one pure resolver so every handler (tools, map,
 * workspace) agrees on what a key means, and the `?` dialog lists the same table.
 * Every shortcut is off while focus is in an input or a dialog / menu is open.
 */
import type { ToolId } from '@/components/tools/types';

export type ShortcutAction =
  | { kind: 'tool'; tool: ToolId }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'delete' }
  | { kind: 'duplicate' }
  | { kind: 'selectAll' }
  | { kind: 'escape' }
  | { kind: 'enter' }
  | { kind: 'board'; index: number }
  | { kind: 'grid' }
  | { kind: 'labels' }
  | { kind: 'chat' }
  | { kind: 'panel' }
  | { kind: 'help' };

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target?: EventTarget | null;
}

export const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  p: 'pen',
  l: 'line',
  a: 'arrow',
  c: 'circle',
  g: 'polygon',
  t: 'text',
  m: 'marker',
  e: 'eraser',
  r: 'measure',
  k: 'laser',
};

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.userAgent);
}

/** Focus in a text field, or inside an open dialog / menu: shortcuts stay off. */
export function shortcutsBlocked(target: EventTarget | null | undefined): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    return true;
  return target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

/**
 * What a keydown means, or null. `mac` switches the modifier to Cmd (Ctrl still means Ctrl,
 * so Ctrl+Y works everywhere as the spec lists it).
 */
export function resolveShortcut(e: KeyLike, mac: boolean): ShortcutAction | null {
  if (shortcutsBlocked(e.target)) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y' && !e.shiftKey) return { kind: 'redo' };
    if (key === 'd' && !e.shiftKey) return { kind: 'duplicate' };
    if (key === 'a' && !e.shiftKey) return { kind: 'selectAll' };
    return null;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return { kind: 'help' };
  if (e.key === 'Escape') return { kind: 'escape' };
  if (e.key === 'Enter') return { kind: 'enter' };
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'delete' };
  if (e.shiftKey) return key === 'g' ? { kind: 'grid' } : null;
  if (key === 'n') return { kind: 'labels' };
  if (key === '/') return { kind: 'chat' };
  if (key === ']') return { kind: 'panel' };
  if (/^[1-9]$/.test(key)) return { kind: 'board', index: Number(key) - 1 };
  const tool = TOOL_KEYS[key];
  return tool ? { kind: 'tool', tool } : null;
}

/** The `?` dialog (UI_UX_SPEC §8). `mod` is rendered as Ctrl or ⌘. */
export function shortcutHelp(mac: boolean): { group: string; items: [string, string][] }[] {
  const mod = mac ? '⌘' : 'Ctrl';
  return [
    {
      group: 'Tools',
      items: [
        ['V', 'Select'],
        ['P', 'Pen'],
        ['L', 'Line'],
        ['A', 'Arrow'],
        ['C', 'Circle'],
        ['G', 'Polygon'],
        ['T', 'Text'],
        ['M', 'Marker'],
        ['E', 'Eraser'],
        ['R', 'Measure'],
        ['K', 'Laser'],
      ],
    },
    {
      group: 'Editing',
      items: [
        [`${mod} Z`, 'Undo'],
        [`${mod} Shift Z / Ctrl Y`, 'Redo'],
        ['Del / Backspace', 'Delete selection'],
        [`${mod} D`, 'Duplicate selection'],
        [`${mod} A`, 'Select all on active layer'],
        ['Esc', 'Cancel / clear selection'],
        ['Enter', 'Finish polygon / arrow'],
        ['Shift + draw', 'Snap to 15° / circle from edge'],
        ['Shift + click', 'Add / remove from selection'],
        ['Shift + drag', 'Marquee select'],
      ],
    },
    {
      group: 'Map & room',
      items: [
        ['Space (hold)', 'Pan'],
        ['1 – 9', 'Switch board'],
        ['Shift G', 'Toggle grid'],
        ['N', 'Toggle map labels'],
        ['/', 'Focus chat'],
        [']', 'Toggle right panel'],
        ['?', 'This help'],
      ],
    },
  ];
}
