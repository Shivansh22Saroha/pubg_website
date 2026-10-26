'use client';

import {
  DRAWING_PALETTE,
  ELEMENT_LIMITS,
  ElementInputSchema,
  MAX_FILL_OPACITY,
  STROKE_WIDTHS,
  ZONE_PRESETS,
  can,
  type ElementInput,
  type MapId,
  type RoomRole,
  type Style,
} from '@rotationlab/shared';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { safeColor } from '@/components/map/markerDom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { editorActions, type EditSink } from '@/lib/editing';
import { cn } from '@/lib/utils';
import type { ViewElement } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { styleFor, useToolStore, type TextSize } from '@/stores/toolStore';
import { deleteChanges, editChanges } from './scene';
import { isCreationTool } from './types';

const WIDTH_LABEL: Record<number, string> = { 2: 'S', 4: 'M', 7: 'L' };
const VECTOR = new Set(['STROKE', 'LINE', 'ARROW', 'CIRCLE', 'POLYGON']);
const CLOSED = new Set(['CIRCLE', 'POLYGON']);
const EMPTY: readonly string[] = [];

/** One change = one batch: parse so a patch can never send something the server rejects. */
function patched(input: ElementInput, fn: (i: ElementInput) => unknown): ElementInput {
  const next = ElementInputSchema.safeParse(fn(input));
  return next.success ? next.data : input;
}

function Seg({ children, className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-control px-1.5 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text aria-pressed:bg-surface-2 aria-pressed:text-text',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-border" />;

/**
 * Floating style bar (UI_UX_SPEC §3.5), bottom-centre of the map. With a drawing tool it edits
 * that tool's remembered style; with a selection it edits the selected elements — every change
 * is one batch and one undo step — and adds Delete and "Move to layer".
 */
export function StyleBar({
  role,
  mapId,
  session,
  nameOf,
}: {
  role: RoomRole;
  mapId: MapId;
  session: EditSink | null;
  nameOf: (userId: string | null) => string;
}) {
  const tool = useToolStore((s) => s.tool);
  const styles = useToolStore((s) => s.styles);
  const setStyle = useToolStore((s) => s.setStyle);
  const textSize = useToolStore((s) => s.textSize);
  const markerLabel = useToolStore((s) => s.markerLabel);
  const presetRadius = useToolStore((s) => s.presetRadius);
  const selectedIds = useSelectionStore((s) => (tool === 'select' ? s.ids : EMPTY));
  const elements = useBoardStore((s) => s.view.elements);
  const layers = useBoardStore((s) => s.view.layers);
  const selected = useMemo(
    () => selectedIds.map((id) => elements[id]).filter((e): e is ViewElement => e !== undefined),
    [selectedIds, elements],
  );
  const actions = editorActions(session, nameOf);

  if (!can(role, 'board.edit')) {
    return (
      <Shell>
        <p className="px-2 text-xs text-text-muted" data-testid="view-only">
          View only — ask the owner for edit access
        </p>
      </Shell>
    );
  }

  // ---- selection mode ----------------------------------------------------------------------
  if (selected.length > 0) {
    const first = selected[0];
    if (!first) return null;
    const ids = selected.map((e) => e.id);
    const edit = (fn: (i: ElementInput) => unknown, only?: (e: ViewElement) => boolean) => {
      const target = only ? selected.filter(only).map((e) => e.id) : ids;
      actions.commit(editChanges(elements, target, (i) => patched(i, fn)));
    };
    const editStyle = (patch: Partial<Style>, only?: (e: ViewElement) => boolean) => {
      edit((i) => ({ ...i, style: { ...i.style, ...patch } }), only);
    };
    const anyVector = selected.some((e) => VECTOR.has(e.type));
    const anyClosed = selected.some((e) => CLOSED.has(e.type));
    const single = selected.length === 1 ? first : undefined;
    const labelOf = (e: ViewElement) => {
      const p = e.props as { text?: string; label?: string };
      return e.type === 'TEXT' ? (p.text ?? '') : (p.label ?? '');
    };
    return (
      <Shell testId="style-bar" mode="selection">
        <span className="px-1 text-xs text-text-muted" data-testid="selection-count">
          {selected.length} selected
        </span>
        <Divider />
        <Palette
          value={first.style.color}
          onPick={(color) => {
            editStyle({ color });
          }}
        />
        {anyVector && (
          <>
            <Divider />
            <Widths
              value={first.style.width}
              onPick={(width) => {
                editStyle({ width }, (e) => VECTOR.has(e.type));
              }}
            />
            <Seg
              aria-pressed={first.style.dashed}
              aria-label="Dashed"
              onClick={() => {
                editStyle({ dashed: !first.style.dashed }, (e) => VECTOR.has(e.type));
              }}
            >
              ┄
            </Seg>
          </>
        )}
        {anyClosed && (
          <>
            <Divider />
            <Fill
              key={`${first.id}:${first.style.fillOpacity}`}
              value={(selected.find((e) => CLOSED.has(e.type)) ?? first).style.fillOpacity}
              onCommit={(fillOpacity) => {
                editStyle({ fillOpacity }, (e) => CLOSED.has(e.type));
              }}
            />
          </>
        )}
        {single && (single.type === 'MARKER' || single.type === 'TEXT') && (
          <>
            <Divider />
            <LabelInput
              key={`${single.id}:${labelOf(single)}`}
              initial={labelOf(single)}
              label={single.type === 'TEXT' ? 'Text' : 'Label'}
              maxLength={
                single.type === 'TEXT' ? ELEMENT_LIMITS.textMax : ELEMENT_LIMITS.markerLabelMax
              }
              onCommit={(raw) => {
                const value = raw.trim();
                if (single.type === 'TEXT') {
                  if (value) edit((i) => ({ ...i, props: { ...i.props, text: value } }));
                  return;
                }
                edit((i) => {
                  const props: Record<string, unknown> = { ...i.props };
                  if (value) props.label = value;
                  else Reflect.deleteProperty(props, 'label');
                  return { ...i, props };
                });
              }}
            />
          </>
        )}
        <Divider />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-7 items-center gap-1 rounded-control px-2 text-xs text-text-muted hover:bg-surface-2 hover:text-text">
            Move to layer <ChevronDown className="size-3" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            <DropdownMenuLabel>Move {selected.length} to…</DropdownMenuLabel>
            {layers.map((l) => (
              <DropdownMenuItem
                key={l.id}
                disabled={l.locked}
                onSelect={() => {
                  edit(
                    (i) => ({ ...i, layerId: l.id }),
                    (e) => e.layerId !== l.id,
                  );
                }}
              >
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: safeColor(l.color) }}
                />
                {l.name}
                {l.locked && <span className="ml-auto text-text-muted">locked</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Seg
          aria-label="Delete selection"
          title="Delete (Del)"
          className="text-danger hover:text-danger"
          onClick={() => {
            if (actions.commit(deleteChanges(elements, ids))) useSelectionStore.getState().clear();
          }}
        >
          <Trash2 className="size-4" aria-hidden />
        </Seg>
      </Shell>
    );
  }

  // ---- drawing-tool mode -------------------------------------------------------------------
  if (!isCreationTool(tool)) return null;
  const st = styleFor({ styles }, tool);
  const set = (patch: Partial<Style>) => {
    setStyle(tool, patch);
  };
  const closed = tool === 'circle' || tool === 'polygon';
  const vector = tool !== 'text' && tool !== 'marker';
  const presets = ZONE_PRESETS[mapId];
  return (
    <Shell testId="style-bar" mode="tool">
      <Palette
        value={st.color}
        onPick={(color) => {
          set({ color });
        }}
      />
      {vector && (
        <>
          <Divider />
          <Widths
            value={st.width}
            onPick={(width) => {
              set({ width });
            }}
          />
          <Seg
            aria-pressed={st.dashed}
            aria-label="Dashed"
            onClick={() => {
              set({ dashed: !st.dashed });
            }}
          >
            ┄
          </Seg>
        </>
      )}
      {closed && (
        <>
          <Divider />
          <Fill
            key={`${tool}:${st.fillOpacity}`}
            value={st.fillOpacity}
            onCommit={(f) => {
              set({ fillOpacity: f });
            }}
          />
        </>
      )}
      {tool === 'text' && (
        <>
          <Divider />
          {(['sm', 'md', 'lg'] as TextSize[]).map((size) => (
            <Seg
              key={size}
              aria-pressed={textSize === size}
              aria-label={`Text size ${size}`}
              onClick={() => {
                useToolStore.getState().setTextSize(size);
              }}
            >
              {size.toUpperCase()}
            </Seg>
          ))}
        </>
      )}
      {tool === 'marker' && (
        <>
          <Divider />
          <input
            aria-label="Marker label"
            placeholder="Label (optional)"
            maxLength={ELEMENT_LIMITS.markerLabelMax}
            value={markerLabel}
            onChange={(e) => {
              useToolStore.getState().setMarkerLabel(e.target.value);
            }}
            className="h-7 w-36 rounded-control border bg-bg px-2 text-xs outline-none focus:ring-2 focus:ring-accent"
          />
        </>
      )}
      {tool === 'circle' && presets.length > 0 && (
        <>
          <Divider />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-7 items-center gap-1 rounded-control px-2 text-xs text-text-muted hover:bg-surface-2 hover:text-text">
              {presetRadius === null ? 'Zone presets' : 'Preset armed'}{' '}
              <ChevronDown className="size-3" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top">
              <DropdownMenuItem
                onSelect={() => {
                  useToolStore.getState().setPresetRadius(null);
                }}
              >
                Free drawing
              </DropdownMenuItem>
              {presets.map((p) => (
                <DropdownMenuItem
                  key={p.label}
                  onSelect={() => {
                    useToolStore.getState().setPresetRadius(p.radiusMetres * 100);
                  }}
                >
                  {p.label} · {p.radiusMetres} m
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </Shell>
  );
}

function Shell({
  children,
  testId,
  mode,
}: {
  children: ReactNode;
  testId?: string;
  mode?: 'tool' | 'selection';
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 z-[1000] flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Style"
        data-testid={testId}
        data-mode={mode}
        data-rl-overlay=""
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-0.5 rounded-panel border bg-surface/95 p-1.5 shadow-panel backdrop-blur"
      >
        {children}
      </div>
    </div>
  );
}

function Palette({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const custom = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  // the native colour dialog fires `input` while dragging: commit once, on `change`
  useEffect(() => {
    const el = custom.current;
    if (!el) return;
    const onChange = () => {
      pick.current(el.value.toUpperCase());
    };
    el.addEventListener('change', onChange);
    return () => {
      el.removeEventListener('change', onChange);
    };
  }, []);
  const upper = value.toUpperCase();
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Colour">
      {DRAWING_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          aria-pressed={upper === c}
          onClick={() => {
            onPick(c);
          }}
          className={cn(
            'size-6 rounded-full border-2 border-transparent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
            upper === c && 'border-text',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      <label
        className="relative ml-0.5 size-6 cursor-pointer overflow-hidden rounded-full border bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]"
        title="Custom colour"
      >
        <span className="sr-only">Custom colour</span>
        <input
          ref={custom}
          type="color"
          defaultValue={safeColor(value).toLowerCase()}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function Widths({
  value,
  onPick,
}: {
  value: number;
  onPick: (w: (typeof STROKE_WIDTHS)[number]) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Stroke width">
      {STROKE_WIDTHS.map((w) => (
        <Seg
          key={w}
          aria-pressed={value === w}
          aria-label={`Width ${WIDTH_LABEL[w] ?? w}`}
          onClick={() => {
            onPick(w);
          }}
        >
          {WIDTH_LABEL[w]}
        </Seg>
      ))}
    </div>
  );
}

/** Fill opacity 0–60 %: shown live, committed once when the slider is released. */
function Fill({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="flex items-center gap-1.5 px-1 text-xs text-text-muted">
      Fill
      <input
        type="range"
        aria-label="Fill opacity"
        min={0}
        max={MAX_FILL_OPACITY * 100}
        step={5}
        value={Math.round(draft * 100)}
        onChange={(e) => {
          setDraft(Number(e.target.value) / 100);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-20 accent-[var(--accent)]"
      />
      <span className="w-8 font-mono">{Math.round(draft * 100)}%</span>
    </label>
  );
}

function LabelInput({
  initial,
  label,
  maxLength,
  onCommit,
}: {
  initial: string;
  label: string;
  maxLength: number;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    if (value !== initial) onCommit(value);
  };
  return (
    <input
      aria-label={label}
      placeholder={label}
      maxLength={maxLength}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setValue(initial);
      }}
      onBlur={commit}
      className="h-7 w-36 rounded-control border bg-bg px-2 text-xs outline-none focus:ring-2 focus:ring-accent"
    />
  );
}
