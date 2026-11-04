'use client';

import {
  can,
  MARKER_DEFAULT_COLORS,
  MARKER_KINDS,
  type MarkerKind,
  type RoomRole,
} from '@rotationlab/shared';
import {
  Circle,
  Eraser,
  MapPin,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Pentagon,
  Redo2,
  Ruler,
  Slash,
  Sparkle,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { safeColor } from '@/components/map/markerDom';
import { editorActions, type EditSink } from '@/lib/editing';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/boardStore';
import { useToolStore } from '@/stores/toolStore';
import type { Breakpoint } from '@/hooks/useBreakpoint';
import { resolveActiveLayer, toolsFor } from './gating';
import { IMPLEMENTED_TOOLS, type ToolId } from './types';

const TOOLS: { id: ToolId; label: string; key: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'pen', label: 'Pen', key: 'P', icon: Pencil },
  { id: 'line', label: 'Line', key: 'L', icon: Slash },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight },
  { id: 'circle', label: 'Circle', key: 'C', icon: Circle },
  { id: 'polygon', label: 'Polygon', key: 'G', icon: Pentagon },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'marker', label: 'Marker', key: 'M', icon: MapPin },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'measure', label: 'Measure', key: 'R', icon: Ruler },
  { id: 'laser', label: 'Laser', key: 'K', icon: Sparkle },
];

export const MARKER_LABELS: Record<MarkerKind, string> = {
  own_squad: 'Own squad',
  own_player: 'Own player',
  enemy_squad: 'Enemy squad',
  vehicle: 'Vehicle',
  drop: 'Drop',
  danger: 'Danger',
  hold: 'Hold / compound',
  pin: 'Pin',
  loot: 'Loot',
};

function ToolButton({
  label,
  shortcut,
  icon: Icon,
  active,
  disabled,
  soon,
  onClick,
  testId,
}: {
  label: string;
  shortcut: string;
  icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  /** not built yet (Measure, Laser) */
  soon?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active ?? undefined}
      aria-disabled={disabled || undefined}
      title={soon ? `${label} (${shortcut}) — coming in a later update` : `${label} (${shortcut})`}
      data-testid={testId}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors pointer-coarse:size-11',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        active
          ? 'bg-[linear-gradient(180deg,var(--accent-hi),var(--accent))] text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_6px_16px_-6px_var(--accent-glow)]'
          : 'hover:bg-surface-3 hover:text-text',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-text-muted',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/**
 * Toolbar (UI_UX_SPEC §3.5 / §7): the tools this role may use at this breakpoint (viewers:
 * Select, Measure, Laser; phones: Select, Marker, Measure, Laser), the marker picker flyout,
 * and undo / redo — disabled while their stack is empty. A left column on desktop, a
 * horizontally scrollable bottom bar on tablets and phones.
 */
export function Toolbar({
  role,
  session,
  nameOf,
  breakpoint = 'desktop',
  orientation = 'vertical',
}: {
  role: RoomRole;
  session: EditSink | null;
  nameOf: (userId: string | null) => string;
  breakpoint?: Breakpoint;
  orientation?: 'vertical' | 'horizontal';
}) {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const markerKind = useToolStore((s) => s.markerKind);
  const [pickerOpen, setPickerOpen] = useState(false);
  const undoCount = useBoardStore((s) =>
    s.boardId ? (s.history[s.boardId]?.undo.length ?? 0) : 0,
  );
  const redoCount = useBoardStore((s) =>
    s.boardId ? (s.history[s.boardId]?.redo.length ?? 0) : 0,
  );
  const allowed = toolsFor(role, breakpoint);
  const horizontal = orientation === 'horizontal';
  const actions = editorActions(session, nameOf);
  const canEdit = can(role, 'board.edit');

  const pickMarker = (kind: MarkerKind) => {
    const { view } = useBoardStore.getState();
    const layer = resolveActiveLayer(view.layers, useToolStore.getState().activeLayerId);
    useToolStore.getState().setMarkerKind(kind, layer?.color ?? '#F2A900');
    setTool('marker');
    setPickerOpen(false);
  };

  return (
    <nav
      aria-label="Drawing tools"
      data-testid="toolbar"
      data-tour="toolbar"
      data-orientation={orientation}
      className={cn(
        'flex shrink-0 items-center gap-1 bg-[linear-gradient(90deg,var(--surface),var(--bg))]',
        horizontal
          ? 'h-14 w-full flex-row overflow-x-auto overscroll-x-contain border-t px-2 pointer-coarse:h-16'
          : 'w-14 flex-col overflow-y-auto border-r py-2',
      )}
    >
      {TOOLS.filter((t) => allowed.includes(t.id)).map((t) => {
        const implemented = IMPLEMENTED_TOOLS.has(t.id);
        if (t.id === 'marker') {
          return (
            <Popover.Root key={t.id} open={pickerOpen} onOpenChange={setPickerOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label={`${t.label} — ${MARKER_LABELS[markerKind]}`}
                  aria-pressed={tool === 'marker'}
                  title={`${t.label} (${t.key})`}
                  data-testid="tool-marker"
                  data-tool-button=""
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors pointer-coarse:size-11',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                    tool === 'marker'
                      ? 'bg-accent text-accent-fg'
                      : 'hover:bg-surface-2 hover:text-text',
                  )}
                  onClick={() => {
                    setTool('marker');
                  }}
                >
                  <MapPin className="size-5" aria-hidden />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side={horizontal ? 'top' : 'right'}
                  align="start"
                  sideOffset={8}
                  className="glass z-50 w-52 rounded-panel p-1"
                  aria-label="Marker kind"
                >
                  <ul role="listbox" aria-label="Marker kind" className="flex flex-col">
                    {MARKER_KINDS.map((kind) => (
                      <li key={kind}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={kind === markerKind}
                          data-testid={`marker-kind-${kind}`}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 pointer-coarse:min-h-11',
                            kind === markerKind && 'bg-surface-2',
                          )}
                          onClick={() => {
                            pickMarker(kind);
                          }}
                        >
                          <span
                            aria-hidden
                            className="size-3 rounded-full border border-black/40"
                            style={{
                              backgroundColor: safeColor(MARKER_DEFAULT_COLORS[kind], '#94A3B8'),
                            }}
                          />
                          {MARKER_LABELS[kind]}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          );
        }
        return (
          <span key={t.id} data-tool-button="">
            <ToolButton
              label={t.label}
              shortcut={t.key}
              icon={t.icon}
              active={tool === t.id}
              disabled={!implemented}
              soon={!implemented}
              testId={`tool-${t.id}`}
              onClick={() => {
                setTool(t.id);
              }}
            />
          </span>
        );
      })}
      {canEdit && (
        <>
          <span
            aria-hidden
            className={cn('shrink-0 bg-border', horizontal ? 'mx-1 h-8 w-px' : 'my-1 h-px w-8')}
          />
          <ToolButton
            label="Undo"
            shortcut="Ctrl+Z"
            icon={Undo2}
            disabled={undoCount === 0}
            testId="undo"
            onClick={() => {
              actions.undo();
            }}
          />
          <ToolButton
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            icon={Redo2}
            disabled={redoCount === 0}
            testId="redo"
            onClick={() => {
              actions.redo();
            }}
          />
        </>
      )}
    </nav>
  );
}
