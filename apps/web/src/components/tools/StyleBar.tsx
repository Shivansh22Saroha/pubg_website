'use client';

import {
  DRAWING_PALETTE,
  LOOT_CATEGORIES,
  LOOT_CATEGORY_NAMES,
  LOOT_ITEMS,
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
  type ZonePreset,
} from '@rotationlab/shared';
import { ChevronDown, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { v7 as uuid } from 'uuid';
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
import { measureLines } from '@/lib/measureToLine';
import { MAX_PENDING } from '@/stores/boardModel';
import { useMeasureStore } from '@/stores/measureStore';
import { usePlayersStore } from '@/stores/playersStore';
import { cn } from '@/lib/utils';
import type { ViewElement } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { styleFor, useToolStore, type TextSize } from '@/stores/toolStore';
import { BLOCK_MESSAGES, creationBlock, resolveActiveLayer } from './gating';
import { deleteChanges, editChanges } from './scene';
import { isCreationTool } from './types';

const WIDTH_LABEL: Record<number, string> = { 2: 'S', 4: 'M', 7: 'L' };
const VECTOR = new Set(['STROKE', 'LINE', 'ARROW', 'CIRCLE', 'POLYGON']);
const CLOSED = new Set(['CIRCLE', 'POLYGON']);
const EMPTY: readonly string[] = [];

/** an arrow flag on or off, keeping the other props ({} when none is left) */
function withFlag(props: Record<string, unknown>, key: 'doubleHeaded' | 'curved', on: boolean) {
  const next: Record<string, unknown> = { ...props };
  if (on) next[key] = true;
  else Reflect.deleteProperty(next, key);
  return next;
}

const isLoot = (e: ViewElement) =>
  e.type === 'MARKER' && (e.props as { kind?: unknown }).kind === 'loot';

/** Loot marker item (Phase 12): PUBG's item icons, grouped like the in-game inventory. */
function LootSelect({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <select
      aria-label="Loot item"
      data-testid="loot-item"
      value={value}
      onChange={(e) => {
        onPick(e.target.value);
      }}
      className="h-7 max-w-44 rounded-control border bg-bg px-1 text-xs outline-none focus:ring-2 focus:ring-accent"
    >
      {!value && <option value="">Item…</option>}
      {LOOT_CATEGORIES.map((cat) => (
        <optgroup key={cat} label={LOOT_CATEGORY_NAMES[cat]}>
          {LOOT_ITEMS.filter((i) => i.category === cat).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const isOwnPlayer = (e: ViewElement) =>
  e.type === 'MARKER' && (e.props as { kind?: unknown }).kind === 'own_player';
const linkedId = (e: ViewElement): string | undefined => {
  const id = (e.props as { memberId?: unknown }).memberId;
  return typeof id === 'string' ? id : undefined;
};

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
  presets: injectedPresets,
}: {
  role: RoomRole;
  mapId: MapId;
  session: EditSink | null;
  nameOf: (userId: string | null) => string;
  /** zone presets for the circle tool (default: ZONE_PRESETS of the map; tests inject) */
  presets?: readonly ZonePreset[];
}) {
  const tool = useToolStore((s) => s.tool);
  const styles = useToolStore((s) => s.styles);
  const setStyle = useToolStore((s) => s.setStyle);
  const textSize = useToolStore((s) => s.textSize);
  const markerLabel = useToolStore((s) => s.markerLabel);
  const presetRadius = useToolStore((s) => s.presetRadius);
  const arrowDoubleHeaded = useToolStore((s) => s.arrowDoubleHeaded);
  const players = usePlayersStore((s) => s.players);
  const arrowCurved = useToolStore((s) => s.arrowCurved);
  const markerKind = useToolStore((s) => s.markerKind);
  const lootItemId = useToolStore((s) => s.lootItem);
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
    const arrows = selected.filter((e) => e.type === 'ARROW');
    const allDouble = arrows.length > 0 && arrows.every((e) => e.props.doubleHeaded === true);
    const allCurved = arrows.length > 0 && arrows.every((e) => e.props.curved === true);
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
            {arrows.length > 0 && (
              <Seg
                aria-pressed={allDouble}
                aria-label="Double-headed"
                title="Double-headed arrow"
                onClick={() => {
                  // one batch, one undo step, arrows only
                  edit(
                    (i) => ({ ...i, props: withFlag(i.props, 'doubleHeaded', !allDouble) }),
                    (e) => e.type === 'ARROW',
                  );
                }}
              >
                ⟷
              </Seg>
            )}
            {arrows.length > 0 && (
              <Seg
                aria-pressed={allCurved}
                aria-label="Curved"
                title="Curved arrow (through its bends)"
                onClick={() => {
                  edit(
                    (i) => ({ ...i, props: withFlag(i.props, 'curved', !allCurved) }),
                    (e) => e.type === 'ARROW',
                  );
                }}
              >
                ∿
              </Seg>
            )}
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
        {single && isLoot(single) && (
          <>
            <Divider />
            <LootSelect
              value={typeof single.props.item === 'string' ? single.props.item : ''}
              onPick={(id) => {
                edit((i) => ({ ...i, props: { ...i.props, item: id } }));
              }}
            />
          </>
        )}
        {single && isOwnPlayer(single) && (
          <>
            <Divider />
            <select
              aria-label="Linked player"
              data-testid="player-link"
              value={linkedId(single) ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                // one batch, one undo step; a link replaces a typed label (the IGN is shown)
                edit((i) => {
                  const props: Record<string, unknown> = { ...i.props };
                  Reflect.deleteProperty(props, 'label');
                  if (id) props.memberId = id;
                  else Reflect.deleteProperty(props, 'memberId');
                  return { ...i, props };
                });
              }}
              className="h-7 max-w-40 rounded-control border bg-bg px-1 text-xs outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Not linked</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label === p.displayName ? p.label : `${p.label} (${p.displayName})`}
                </option>
              ))}
              {/* a link to someone who has left the room stays visible until changed */}
              {linkedId(single) && !players.some((p) => p.id === linkedId(single)) && (
                <option value={linkedId(single)}>Former member</option>
              )}
            </select>
          </>
        )}
        {single && (single.type === 'MARKER' || single.type === 'TEXT') && !linkedId(single) && (
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

  // ---- measure: "Save as line" (Phase 11) ---------------------------------------------------
  if (tool === 'measure') {
    return <MeasureSave role={role} styles={styles} commit={(c) => actions.commit(c)} />;
  }

  // ---- drawing-tool mode -------------------------------------------------------------------
  if (!isCreationTool(tool)) return null;
  const st = styleFor({ styles }, tool);
  const set = (patch: Partial<Style>) => {
    setStyle(tool, patch);
  };
  const closed = tool === 'circle' || tool === 'polygon';
  const vector = tool !== 'text' && tool !== 'marker';
  const presets = injectedPresets ?? ZONE_PRESETS[mapId];
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
          {tool === 'arrow' && (
            <Seg
              aria-pressed={arrowDoubleHeaded}
              aria-label="Double-headed"
              title="Double-headed arrow"
              onClick={() => {
                useToolStore.getState().setArrowDoubleHeaded(!arrowDoubleHeaded);
              }}
            >
              ⟷
            </Seg>
          )}
          {tool === 'arrow' && (
            <Seg
              aria-pressed={arrowCurved}
              aria-label="Curved"
              title="Curved arrow (through its bends)"
              onClick={() => {
                useToolStore.getState().setArrowCurved(!arrowCurved);
              }}
            >
              ∿
            </Seg>
          )}
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
      {tool === 'marker' && markerKind === 'loot' && (
        <>
          <Divider />
          <LootSelect
            value={lootItemId}
            onPick={(id) => {
              useToolStore.getState().setLootItem(id);
            }}
          />
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
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-0.5 glass rounded-panel p-1.5"
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

/**
 * Measure tool, Editor+ (Phase 11, FEATURES F11): once a measure is finished, "Save as line"
 * turns it into LINE elements on the active layer with the Line tool's style — one action, so
 * one undo removes it — and clears the local measure line.
 */
function MeasureSave({
  role,
  styles,
  commit,
}: {
  role: RoomRole;
  styles: ReturnType<typeof useToolStore.getState>['styles'];
  commit: (changes: { id: string; before: null; after: ElementInput }[]) => boolean;
}) {
  const line = useMeasureStore((s) => s.line);
  if (!can(role, 'board.edit') || !line?.finished || line.points.length < 2) return null;
  const save = () => {
    const b = useBoardStore.getState();
    const layer = resolveActiveLayer(b.view.layers, useToolStore.getState().activeLayerId);
    const block = creationBlock({
      role,
      layer,
      elementCount: Object.keys(b.view.elements).length,
      queueFull: b.pending.length >= MAX_PENDING,
    });
    if (block || !layer || !b.boardId) {
      toast.error(BLOCK_MESSAGES[block ?? 'no-layer'](layer?.name), { id: `draw-${block}` });
      return;
    }
    const lines = measureLines(line.points, {
      boardId: b.boardId,
      layerId: layer.id,
      style: styleFor({ styles }, 'line'),
      newId: uuid,
    });
    if (lines.length === 0) return;
    if (commit(lines.map((after) => ({ id: after.id, before: null, after })))) {
      useMeasureStore.setState({ line: null });
      toast.success(lines.length === 1 ? 'Saved as a line' : `Saved as ${lines.length} lines`);
    }
  };
  return (
    <Shell testId="style-bar" mode="tool">
      <span className="px-1 text-xs text-text-muted">Measure</span>
      <Divider />
      <Seg data-testid="measure-save" onClick={save} className="px-2.5">
        Save as line
      </Seg>
    </Shell>
  );
}
