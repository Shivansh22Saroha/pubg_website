'use client';

import {
  can,
  ELEMENT_LIMITS,
  ElementInputSchema,
  elementWithinWorld,
  tileWorldSize,
  type MapConfig,
  type Pt,
  type RoomRole,
} from '@rotationlab/shared';
import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { toast } from 'sonner';
import { v7 as uuid } from 'uuid';
import { textScale } from '@/components/map/ElementLayer';
import { MANUAL_VIEW_EVENT } from '@/components/map/FollowController';
import { clientToWorld, worldPerPx } from '@/lib/coords';
import { editorActions, makeNameOf, toInput } from '@/lib/editing';
import type { RoomSession } from '@/lib/realtime/roomSession';
import { isMacPlatform, resolveShortcut, shortcutsBlocked } from '@/lib/shortcuts';
import { MAX_PENDING } from '@/stores/boardModel';
import { useBoardStore } from '@/stores/boardStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { styleFor, useDraftStore, useToolStore } from '@/stores/toolStore';
import { DraftLayer } from './DraftLayer';
import {
  BLOCK_MESSAGES,
  creationBlock,
  ELEMENT_WARN_AT,
  initials,
  nextMarkerNumber,
  resolveActiveLayer,
  toolsForRole,
  type CreateBlock,
} from './gating';
import { GhostLayer } from './GhostLayer';
import { InlineEditor } from './InlineEditor';
import { PreviewSender } from './previewSender';
import {
  deleteChanges,
  duplicateChanges,
  idsOnLayer,
  isEditable,
  pickRadiusHandle,
  pickTop,
  type Scene,
} from './scene';
import { SelectTool } from './selectTools';
import { SelectionLayer } from './SelectionLayer';
import { createTools, TextTool, type AnyTool } from './tools';
import {
  IMPLEMENTED_TOOLS,
  isCreationTool,
  type ToolContext,
  type ToolId,
  type ToolPointer,
} from './types';

/** Overlays inside the map container (inline editor) that the tools must ignore. */
export const OVERLAY_ATTR = 'data-rl-overlay';

interface Inline {
  at: Pt;
  initial: string;
  maxLength: number;
  label: string;
  submit: (value: string) => void;
  cancel: () => void;
}

/**
 * Wires the active tool to the map (FEATURES F6, UI_UX_SPEC §5/§7/§8):
 * - Pointer Events on the map container (not Leaflet mouse events), captured while a tool owns
 *   the press. Select leaves presses on empty map to Leaflet (pan); a claimed press calls
 *   preventDefault, which suppresses the compat mousedown Leaflet drags on;
 * - Leaflet dragging only in Select; Space-hold or middle mouse pans in any tool;
 *   double-click zoom off while Arrow / Polygon is active; Shift-drag box zoom off;
 * - touch: one finger draws, a second finger cancels the draft and Leaflet pans / pinches;
 * - keyboard shortcuts for tools and editing (the map / workspace own the rest);
 * - every point → integer world units clamped to the map; commits go through the board store.
 */
export function ToolLayer({
  config,
  session,
  role,
  roomName,
  meId,
  names,
}: {
  config: MapConfig;
  session: RoomSession | null;
  role: RoomRole;
  roomName: string;
  meId: string;
  /** userId → display name ("Changed by …") */
  names: Record<string, string>;
}) {
  const map = useMap();
  const tool = useToolStore((s) => s.tool);
  const [inline, setInline] = useState<Inline | null>(null);
  const tools = useRef<Partial<Record<ToolId, AnyTool>>>({});
  const live = useRef({ session, role, roomName, names, meId });
  useEffect(() => {
    live.current = { session, role, roomName, names, meId };
  });

  // tools + DOM plumbing, once per map
  useEffect(() => {
    const { worldSize } = config;
    const tileWorld = tileWorldSize(config);
    const container = map.getContainer();
    const mac = isMacPlatform();
    const current = () => tools.current[useToolStore.getState().tool];
    const style = () => {
      const s = useToolStore.getState();
      return styleFor(s, s.tool);
    };
    const activeLayer = () =>
      resolveActiveLayer(
        useBoardStore.getState().view.layers,
        useToolStore.getState().activeLayerId,
      );
    const block = (): CreateBlock | null => {
      const b = useBoardStore.getState();
      return creationBlock({
        role: live.current.role,
        layer: activeLayer(),
        elementCount: Object.keys(b.view.elements).length,
        queueFull: b.pending.length >= MAX_PENDING,
      });
    };
    const nameOf = (id: string | null) => makeNameOf(live.current.meId, live.current.names)(id);
    const actions = () => editorActions(live.current.session, nameOf);
    const scene = (): Scene => {
      const b = useBoardStore.getState();
      return {
        elements: b.view.elements,
        layers: b.view.layers,
        hidden: useSelectionStore.getState().hiddenLayers,
        worldPerPx: worldPerPx(map, tileWorld),
        textScale: textScale(map.getZoom(), config.maxNativeZoom),
      };
    };

    // "toast once" per reason and layer; reset when the active layer changes
    const shown = new Set<string>();
    let warned = false;
    const explain = (reason: CreateBlock) => {
      const layer = activeLayer();
      const key = `${reason}:${layer?.id ?? ''}`;
      if (reason === 'locked' || reason === 'role' || reason === 'no-layer') {
        if (shown.has(key)) return;
        shown.add(key);
      }
      toast.error(BLOCK_MESSAGES[reason](layer?.name), { id: `draw-${reason}` });
    };

    const sender = new PreviewSender({
      emit: (tempId, points, st) => {
        live.current.session?.strokePreview(tempId, points, st);
      },
      style,
      newId: uuid,
    });

    const selection = useSelectionStore.getState;

    const ctx: ToolContext = {
      worldSize,
      worldPerPx: () => worldPerPx(map, tileWorld),
      style,
      canCreate: () => {
        const reason = block();
        if (reason) explain(reason);
        return reason === null;
      },
      commit: (el) => {
        const reason = block();
        const layer = activeLayer();
        const { boardId } = useBoardStore.getState();
        if (reason || !layer || !boardId) {
          if (reason) explain(reason);
          return false;
        }
        const parsed = ElementInputSchema.safeParse({
          ...el,
          id: uuid(),
          boardId,
          layerId: layer.id,
          z: 0,
        });
        if (!parsed.success || !elementWithinWorld(parsed.data, worldSize)) {
          toast.error('That shape can’t be saved');
          return false;
        }
        const ok = actions().commit([{ id: parsed.data.id, before: null, after: parsed.data }]);
        if (!ok) return false;
        const count = Object.keys(useBoardStore.getState().view.elements).length;
        if (count >= ELEMENT_WARN_AT && !warned) {
          warned = true;
          toast.warning(`This board has ${count} of 5 000 elements`);
        }
        return true;
      },
      setDraft: (draft) => {
        useDraftStore.setState({ draft });
      },
      preview: sender,
      openText: (at) => {
        const t = tools.current.text;
        if (!(t instanceof TextTool)) return;
        setInline({
          at,
          initial: '',
          maxLength: ELEMENT_LIMITS.textMax,
          label: 'Text label',
          submit: (v) => {
            setInline(null);
            t.submit(v);
          },
          cancel: () => {
            setInline(null);
            t.cancel();
          },
        });
      },
      closeText: () => {
        setInline(null);
      },
      textSize: () => useToolStore.getState().textSize,
      markerProps: () => {
        const { markerKind: kind, markerLabel } = useToolStore.getState();
        const label =
          markerLabel.trim() || (kind === 'own_squad' ? initials(live.current.roomName) : '');
        return {
          kind,
          number: nextMarkerNumber(useBoardStore.getState().view.elements, kind),
          ...(label && { label }),
        };
      },
      presetRadius: () => useToolStore.getState().presetRadius,

      scene,
      canEdit: () => {
        if (can(live.current.role, 'board.edit')) return true;
        explain('role');
        return false;
      },
      selection: () => selection().ids,
      select: (ids) => {
        selection().select(ids);
      },
      setTransform: (t) => {
        selection().setTransform(t);
      },
      setMarquee: (b) => {
        selection().setMarquee(b);
      },
      setHighlight: (ids) => {
        selection().setHighlight(ids);
      },
      commitChanges: (changes) => actions().commit(changes),
      editInline: (id) => {
        const el = useBoardStore.getState().view.elements[id];
        if (!el || (el.type !== 'TEXT' && el.type !== 'MARKER')) return;
        const input = toInput(el);
        const at = (el.geometry as { at: Pt }).at;
        const props = el.props as { text?: string; label?: string };
        const isText = el.type === 'TEXT';
        setInline({
          at,
          initial: (isText ? props.text : props.label) ?? '',
          maxLength: isText ? ELEMENT_LIMITS.textMax : ELEMENT_LIMITS.markerLabelMax,
          label: isText ? 'Edit text' : 'Marker label',
          submit: (raw) => {
            setInline(null);
            const value = raw.trim();
            if (isText && value.length === 0) return; // text needs 1–120 chars
            const nextProps: Record<string, unknown> = { ...input.props };
            if (isText) nextProps.text = value;
            else if (value) nextProps.label = value;
            else Reflect.deleteProperty(nextProps, 'label');
            const parsed = ElementInputSchema.safeParse({ ...input, props: nextProps });
            if (parsed.success) actions().commit([{ id, before: input, after: parsed.data }]);
          },
          cancel: () => {
            setInline(null);
          },
        });
      },
      laser: ([x, y]) => {
        live.current.session?.laser(x, y);
      },
      explainLocked: (layer) => {
        const key = `locked-hit:${layer.id}`;
        if (shown.has(key)) return;
        shown.add(key);
        toast(`Layer “${layer.name}” is locked`, { id: key });
      },
    };
    tools.current = createTools(ctx);

    // ---- cursor ---------------------------------------------------------------------------
    let spaceHeld = false;
    let pan: { id: number; x: number; y: number } | null = null;
    let hoverCursor = '';
    const updateCursor = () => {
      const id = useToolStore.getState().tool;
      const t = tools.current[id];
      let cursor = hoverCursor || t?.cursor || '';
      if (isCreationTool(id) && block() !== null) cursor = 'not-allowed';
      if (spaceHeld || pan) cursor = pan ? 'grabbing' : 'grab';
      container.style.cursor = cursor;
    };

    // ---- pointer routing ------------------------------------------------------------------
    const touches = new Set<number>();
    let touchBlocked = false;
    /** the press a tool is following; `claimed` = captured, Leaflet doesn't see it */
    let press: { id: number; claimed: boolean } | null = null;
    const pointer = (e: PointerEvent | MouseEvent): ToolPointer => ({
      world: clientToWorld(map, e, worldSize),
      screen: [e.clientX, e.clientY],
      shiftKey: e.shiftKey,
      button: e.button,
    });
    const fromOverlay = (e: Event) =>
      e.target instanceof Element && e.target.closest(`[${OVERLAY_ATTR}]`) !== null;
    const toolId = () => useToolStore.getState().tool;
    const usesLeafletDrag = () => toolId() === 'select';

    const onDown = (e: PointerEvent) => {
      if (fromOverlay(e)) return;
      if (e.pointerType === 'touch') {
        touches.add(e.pointerId);
        if (touches.size > 1) {
          // second finger: abandon the draft, Leaflet pans / pinches
          current()?.cancel();
          if (press?.claimed && container.hasPointerCapture(press.id))
            container.releasePointerCapture(press.id);
          press = null;
          touchBlocked = true;
          return;
        }
      }
      const wantsPan = e.button === 1 || (spaceHeld && e.button === 0);
      if (wantsPan) {
        if (usesLeafletDrag() && e.button === 0) return; // Leaflet already drags
        e.preventDefault();
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        container.setPointerCapture(e.pointerId);
        updateCursor();
        return;
      }
      const t = current();
      if (!t || e.button !== 0 || touchBlocked || press) return;
      // only Select may leave a press to Leaflet (pan); every other tool owns it
      const p = pointer(e);
      const claimed = t instanceof SelectTool ? t.onPointerDown(p) : (t.onPointerDown(p), true);
      press = { id: e.pointerId, claimed };
      if (claimed) {
        e.preventDefault(); // no Leaflet drag, no text selection / focus stealing
        container.setPointerCapture(e.pointerId);
      }
    };

    let hoverFrame = 0;
    const hover = (e: PointerEvent) => {
      if (toolId() !== 'select' || e.pointerType !== 'mouse') {
        if (hoverCursor) {
          hoverCursor = '';
          updateCursor();
        }
        return;
      }
      const p = pointer(e).world;
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const s = scene();
        const sel = selection().ids;
        const next = !can(live.current.role, 'board.edit')
          ? ''
          : pickRadiusHandle(s, sel, p)
            ? 'ew-resize'
            : pickTop(s, p)
              ? 'move'
              : '';
        if (next !== hoverCursor) {
          hoverCursor = next;
          updateCursor();
        }
      });
    };

    const onMove = (e: PointerEvent) => {
      if (pan && e.pointerId === pan.id) {
        window.dispatchEvent(new Event(MANUAL_VIEW_EVENT)); // a manual pan ends follow mode
        map.panBy([pan.x - e.clientX, pan.y - e.clientY], { animate: false });
        pan = { ...pan, x: e.clientX, y: e.clientY };
        return;
      }
      if (touchBlocked || fromOverlay(e)) return;
      // touch moves only matter while that finger is pressed; mouse hover feeds rubber bands
      if (e.pointerType === 'touch' && e.pointerId !== press?.id) return;
      if (!press) hover(e);
      current()?.onPointerMove(pointer(e));
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (touches.size === 0) touchBlocked = false;
      }
      if (pan && e.pointerId === pan.id) {
        pan = null;
        updateCursor();
        return;
      }
      if (press?.id !== e.pointerId) return;
      press = null;
      current()?.onPointerUp(pointer(e));
    };

    const onCancel = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size === 0) touchBlocked = false;
      if (pan && e.pointerId === pan.id) pan = null;
      if (press?.id === e.pointerId) {
        press = null;
        current()?.cancel();
      }
    };

    // capture phase: runs before Leaflet's own dblclick (zoom), so a consumed one can stop it
    const onDblClick = (e: MouseEvent) => {
      if (fromOverlay(e)) return;
      const t = current();
      if (!t) return;
      const p = pointer(e);
      const consumed = t instanceof SelectTool ? t.onDoubleClick(p) : (t.onDoubleClick(p), false);
      if (consumed) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    const setTool = (id: ToolId) => {
      if (!toolsForRole(live.current.role).includes(id) || !IMPLEMENTED_TOOLS.has(id)) return;
      useToolStore.getState().setTool(id);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutsBlocked(e.target)) return;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (plain && e.key === ' ') {
        e.preventDefault(); // no page scroll
        if (!spaceHeld) {
          spaceHeld = true;
          updateCursor();
        }
        return;
      }
      // the active tool first: Enter / Esc / Backspace mean something while drawing
      if (plain && current()?.onKeyDown({ key: e.key, shiftKey: e.shiftKey })) {
        e.preventDefault();
        return;
      }
      const action = resolveShortcut(e, mac);
      if (!action) return;
      const sel = selection();
      const editable = () => sel.ids.filter((id) => isEditable(scene(), id));
      switch (action.kind) {
        case 'tool':
          setTool(action.tool);
          break;
        case 'undo':
          actions().undo();
          break;
        case 'redo':
          actions().redo();
          break;
        case 'delete': {
          const ids = editable();
          if (ids.length === 0 || !ctx.canEdit()) return;
          if (actions().commit(deleteChanges(scene().elements, ids))) sel.clear();
          break;
        }
        case 'duplicate': {
          e.preventDefault(); // never the browser's bookmark dialog
          const ids = editable();
          if (ids.length === 0 || !ctx.canEdit()) return;
          const changes = duplicateChanges(scene().elements, ids, worldSize, uuid);
          if (actions().commit(changes)) sel.select(changes.map((c) => c.id));
          break;
        }
        case 'selectAll': {
          e.preventDefault();
          const layer = activeLayer();
          if (!layer || !can(live.current.role, 'board.edit')) return;
          setTool('select');
          sel.select(idsOnLayer(scene(), layer.id));
          break;
        }
        case 'escape':
          if (sel.ids.length === 0) return;
          sel.clear();
          break;
        default:
          return; // board / grid / labels / panel / chat / help: handled by the workspace & map
      }
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceHeld = false;
        updateCursor();
      }
    };
    const onBlur = () => {
      spaceHeld = false;
      updateCursor();
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onCancel);
    container.addEventListener('dblclick', onDblClick, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    map.boxZoom.disable(); // Shift is a drawing / selection modifier

    // permissions, layers and the element count change the cursor; a lost permission or a
    // changed active layer ends the draft; selected elements that vanished, got locked or
    // hidden leave the selection
    let lastLayer = activeLayer()?.id;
    const onStores = () => {
      const layerId = activeLayer()?.id;
      if (layerId !== lastLayer) {
        lastLayer = layerId;
        shown.clear();
      }
      const t = current();
      if (t?.busy && isCreationTool(t.id) && block() !== null) t.cancel();
      const sel = selection();
      if (sel.ids.length > 0) {
        const s = scene();
        const keep = can(live.current.role, 'board.edit')
          ? sel.ids.filter((id) => isEditable(s, id))
          : [];
        if (keep.length !== sel.ids.length) sel.select(keep);
      }
      updateCursor();
    };
    const offBoard = useBoardStore.subscribe((s, prev) => {
      if (s.view !== prev.view || s.pending.length !== prev.pending.length) onStores();
    });
    const offTool = useToolStore.subscribe(onStores);
    const offSel = useSelectionStore.subscribe((s, prev) => {
      if (s.hiddenLayers !== prev.hiddenLayers) onStores();
    });
    updateCursor();

    return () => {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onCancel);
      container.removeEventListener('dblclick', onDblClick, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(hoverFrame);
      offBoard();
      offTool();
      offSel();
      for (const t of Object.values(tools.current)) t.cancel();
      sender.end();
      useDraftStore.setState({ draft: null });
      useSelectionStore.getState().clear();
      container.style.cursor = '';
    };
  }, [map, config]);

  // the role changed under us (e.g. demoted to viewer): end drafts, drop the selection
  useEffect(() => {
    if (can(role, 'board.edit')) return;
    const t = tools.current[useToolStore.getState().tool];
    if (t?.busy) t.cancel();
    useSelectionStore.getState().clear();
    if (!toolsForRole(role).includes(useToolStore.getState().tool))
      useToolStore.getState().setTool('select');
  }, [role]);

  // per-tool Leaflet interaction; switching tools cancels the draft and (leaving Select) the
  // selection
  useEffect(() => {
    const container = map.getContainer();
    if (tool === 'select') map.dragging.enable();
    else map.dragging.disable();
    if (tool === 'arrow' || tool === 'polygon') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    container.classList.toggle('rl-drawing', tool !== 'select');
    container.dataset.tool = tool;
    const t = tools.current[tool];
    container.style.cursor = t?.cursor ?? '';
    if (tool !== 'select') useSelectionStore.getState().clear();
    return () => {
      t?.cancel();
    };
  }, [map, tool]);

  return (
    <>
      <DraftLayer />
      <GhostLayer />
      <SelectionLayer config={config} meId={meId} />
      {inline && (
        <InlineEditor
          key={`${inline.at[0]}:${inline.at[1]}:${inline.label}`}
          map={map}
          at={inline.at}
          initial={inline.initial}
          maxLength={inline.maxLength}
          label={inline.label}
          onSubmit={inline.submit}
          onCancel={inline.cancel}
        />
      )}
    </>
  );
}
