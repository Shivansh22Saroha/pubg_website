/**
 * DOM for markers, text labels and cursors (UI_UX_SPEC §6, §6.4). SECURITY V4/V5: built with
 * createElement(NS) + textContent only — user text never touches an HTML string — and every
 * colour passes the #RRGGBB check before it reaches an SVG attribute.
 */

const SVG = 'http://www.w3.org/2000/svg';
const HEX = /^#[0-9A-Fa-f]{6}$/;
export const FALLBACK_COLOR = '#F8FAFC';

export function safeColor(value: unknown, fallback = FALLBACK_COLOR): string {
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function svgText(text: string, attrs: Record<string, string | number>) {
  const t = svgEl('text', {
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'Rajdhani, sans-serif',
    'font-weight': 700,
    ...attrs,
  });
  t.textContent = text;
  return t;
}

export type MarkerKind =
  | 'own_squad'
  | 'own_player'
  | 'enemy_squad'
  | 'vehicle'
  | 'drop'
  | 'danger'
  | 'hold'
  | 'pin'
  | 'loot';

const STROKE = { stroke: '#0B0F14', 'stroke-width': 1.5, 'stroke-linejoin': 'round' };

/** 28 px marker glyphs (UI_UX_SPEC §6.4). */
function glyph(
  kind: MarkerKind,
  color: string,
  number: number | undefined,
  label: string | undefined,
): SVGSVGElement {
  const svg = svgEl('svg', { width: 28, height: 28, viewBox: '0 0 28 28', 'aria-hidden': 'true' });
  const fill = { fill: color, ...STROKE };
  switch (kind) {
    case 'own_squad': {
      svg.append(
        svgEl('path', {
          d: 'M14 2 L25 6 V13 C25 20 20 24.5 14 26 C8 24.5 3 20 3 13 V6 Z',
          ...fill,
        }),
      );
      const initials = (label ?? '')
        .replace(/[^\p{L}\p{N}]/gu, '')
        .slice(0, 2)
        .toUpperCase();
      if (initials)
        svg.append(svgText(initials, { x: 14, y: 14.5, 'font-size': 10, fill: '#0B0F14' }));
      break;
    }
    case 'own_player':
      svg.append(svgEl('circle', { cx: 14, cy: 14, r: 11, ...fill }));
      svg.append(svgText(`P${number ?? ''}`, { x: 14, y: 14.5, 'font-size': 10, fill: '#0B0F14' }));
      break;
    case 'enemy_squad':
      svg.append(svgEl('path', { d: 'M14 1.5 L26.5 14 L14 26.5 L1.5 14 Z', ...fill }));
      svg.append(
        svgText(number !== undefined ? String(number) : '?', {
          x: 14,
          y: 14.5,
          'font-size': 11,
          fill: '#0B0F14',
        }),
      );
      break;
    case 'vehicle':
      svg.append(
        svgEl('path', {
          d: 'M4 17 L6.5 10.5 C7 9 8 8.5 9.5 8.5 H18.5 C20 8.5 21 9 21.5 10.5 L24 17 V21 H4 Z',
          ...fill,
        }),
      );
      svg.append(svgEl('circle', { cx: 9, cy: 21, r: 2.6, fill: '#0B0F14' }));
      svg.append(svgEl('circle', { cx: 19, cy: 21, r: 2.6, fill: '#0B0F14' }));
      break;
    case 'drop':
      svg.append(svgEl('path', { d: 'M3 12 C3 5.5 8 2 14 2 C20 2 25 5.5 25 12 Z', ...fill }));
      svg.append(
        svgEl('path', {
          d: 'M3.5 12 L12.5 21 M24.5 12 L15.5 21 M14 12 V21',
          stroke: color,
          'stroke-width': 1.5,
          fill: 'none',
        }),
      );
      svg.append(svgEl('rect', { x: 11, y: 21, width: 6, height: 5, rx: 1, ...fill }));
      break;
    case 'danger':
      svg.append(svgEl('path', { d: 'M14 2.5 L26 24.5 H2 Z', ...fill }));
      svg.append(svgText('!', { x: 14, y: 17, 'font-size': 14, fill: '#0B0F14' }));
      break;
    case 'hold':
      svg.append(svgEl('path', { d: 'M4 14 L14 6 L24 14 V25 H4 Z', ...fill }));
      svg.append(
        svgEl('path', {
          d: 'M14 6 V1.5 L20 3.5 L14 5.5',
          stroke: '#0B0F14',
          'stroke-width': 1.2,
          fill: color,
        }),
      );
      svg.append(svgEl('rect', { x: 11.5, y: 18, width: 5, height: 7, fill: '#0B0F14' }));
      break;
    case 'loot':
      // a crate: the fallback when the item icon is missing, and the badge under it
      svg.append(
        svgEl('rect', {
          x: 2,
          y: 2,
          width: 24,
          height: 24,
          rx: 5,
          fill: '#0B0F14',
          stroke: color,
          'stroke-width': 2,
        }),
      );
      svg.append(
        svgEl('path', {
          'data-loot-crate': '',
          d: 'M8 10 H20 V20 H8 Z M8 14 H20 M14 10 V20',
          fill: 'none',
          stroke: color,
          'stroke-width': 1.5,
          'stroke-linejoin': 'round',
        }),
      );
      break;
    case 'pin':
      svg.append(
        svgEl('path', {
          d: 'M14 26 C14 26 5 16.5 5 10.5 C5 5.5 9 2 14 2 C19 2 23 5.5 23 10.5 C23 16.5 14 26 14 26 Z',
          ...fill,
        }),
      );
      svg.append(svgEl('circle', { cx: 14, cy: 10.5, r: 3.5, fill: '#0B0F14' }));
      break;
  }
  return svg;
}

/** Marker icon: glyph + optional label pill under it (≤ 24 chars, as text). */
export function markerElement(
  props: { kind?: unknown; number?: unknown; label?: unknown; item?: unknown },
  color: unknown,
  /** loot markers (Phase 12): the item's icon URL, built from the allow-listed item id */
  lootIconUrl?: (itemId: string) => string | null,
): HTMLElement {
  const kinds: MarkerKind[] = [
    'own_squad',
    'own_player',
    'enemy_squad',
    'vehicle',
    'drop',
    'danger',
    'hold',
    'pin',
    'loot',
  ];
  const kind = kinds.includes(props.kind as MarkerKind) ? (props.kind as MarkerKind) : 'pin';
  const number = typeof props.number === 'number' ? props.number : undefined;
  const label = typeof props.label === 'string' ? props.label.slice(0, 24) : undefined;
  const root = document.createElement('div');
  root.className = 'rl-marker';
  root.append(glyph(kind, safeColor(color), number, label));
  const iconUrl =
    kind === 'loot' && typeof props.item === 'string' ? (lootIconUrl?.(props.item) ?? null) : null;
  if (iconUrl) {
    // drawn over the crate badge; if it fails to load, the crate stays
    const img = document.createElement('img');
    img.className = 'rl-loot-icon';
    img.alt = '';
    img.crossOrigin = 'anonymous'; // CORS-clean, so Export PNG can draw it (DEPLOYMENT §4)
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => {
      img.remove();
    });
    // loaded: drop the crate lines so they don't show through the icon's transparent parts
    // (removed from the DOM rather than hidden with CSS, so Export PNG's SVG copy agrees)
    img.addEventListener('load', () => {
      root.querySelector('[data-loot-crate]')?.remove();
    });
    img.src = iconUrl;
    root.append(img);
  }
  if (label && kind !== 'own_squad') {
    const pill = document.createElement('span');
    pill.className = 'rl-marker-label';
    pill.textContent = label;
    root.append(pill);
  }
  return root;
}

const TEXT_SIZES = { sm: 12, md: 14, lg: 18 } as const;

/** World-anchored text label (UI_UX_SPEC §6): pill on rgba(0,0,0,0.6). */
export function textElement(
  props: { text?: unknown; size?: unknown },
  color: unknown,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rl-text';
  el.textContent = typeof props.text === 'string' ? props.text : '';
  const size =
    TEXT_SIZES[
      (props.size as keyof typeof TEXT_SIZES) in TEXT_SIZES
        ? (props.size as keyof typeof TEXT_SIZES)
        : 'md'
    ];
  el.style.fontSize = `${size}px`;
  el.style.color = safeColor(color);
  return el;
}

/** Remote cursor: arrow in the presence colour + name pill. */
export function cursorElement(name: string, color: unknown): HTMLElement {
  const c = safeColor(color, '#38BDF8');
  const root = document.createElement('div');
  root.className = 'rl-cursor';
  const arrow = svgEl('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    'aria-hidden': 'true',
  });
  arrow.append(
    svgEl('path', {
      d: 'M1 1 L1 13 L4.5 9.5 L7 15 L9 14 L6.5 8.5 L11.5 8.5 Z',
      fill: c,
      stroke: '#0B0F14',
      'stroke-width': 1,
    }),
  );
  const pill = document.createElement('span');
  pill.className = 'rl-cursor-name';
  pill.style.backgroundColor = c;
  pill.textContent = name;
  root.append(arrow, pill);
  return root;
}
