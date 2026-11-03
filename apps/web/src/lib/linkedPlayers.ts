import type { ViewElement } from '@/stores/boardModel';

/**
 * Linked own-player markers (Phase 12, FEATURES F7): `props.memberId` points at a room member
 * and the marker's label is that member's IGN (else display name), resolved when drawn — so it
 * follows renames, and nothing name-like is stored on the element. A link to someone who is no
 * longer a member shows no label (the glyph still says "P{n}").
 */
export function linkedLabel(
  el: Pick<ViewElement, 'type' | 'props'>,
  names: Readonly<Record<string, string>>,
): string | undefined {
  if (el.type !== 'MARKER') return undefined;
  const id = (el.props as { memberId?: unknown }).memberId;
  return typeof id === 'string' ? names[id] : undefined;
}

/**
 * The elements with linked markers' labels filled in for the renderer. Unchanged elements keep
 * their identity (the renderer diffs by it); a linked marker gets a new object only when its
 * element or its resolved name changes.
 */
export function withPlayerLabels(
  elements: Readonly<Record<string, ViewElement>>,
  names: Readonly<Record<string, string>>,
  cache: WeakMap<ViewElement, { name: string | undefined; out: ViewElement }>,
): Record<string, ViewElement> {
  let changed = false;
  const out: Record<string, ViewElement> = {};
  for (const [id, el] of Object.entries(elements)) {
    if (el.type !== 'MARKER' || typeof el.props.memberId !== 'string') {
      out[id] = el;
      continue;
    }
    const name = linkedLabel(el, names);
    const hit = cache.get(el);
    if (hit && hit.name === name) {
      out[id] = hit.out;
    } else {
      const props: Record<string, unknown> = { ...el.props };
      if (name) props.label = name;
      else Reflect.deleteProperty(props, 'label');
      const resolved = { ...el, props };
      cache.set(el, { name, out: resolved });
      out[id] = resolved;
    }
    changed = true;
  }
  return changed ? out : elements;
}
