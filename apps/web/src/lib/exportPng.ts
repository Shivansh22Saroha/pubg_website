/**
 * PNG export (FEATURES F12, STUDY-2, UF-12) as a canvas composite — no DOM-screenshot library:
 * the loaded tile <img>s of the visible base variant, the grid canvas (+ its edge letters) when
 * shown, the element canvas, then markers and text labels re-drawn from their DOM, and a
 * footer strip. Cursors, selection, drafts, ghosts, laser, pulses and the HUD are never
 * collected. Tiles must be CORS-clean (`crossOrigin="anonymous"` + an
 * `Access-Control-Allow-Origin` on the tile host) or the canvas would be tainted.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything drawn, in CSS pixels relative to the map container's top-left. */
export interface ExportSources {
  width: number;
  height: number;
  /** devicePixelRatio, capped at 2 */
  scale: number;
  /** the low-res placeholder and the tiles, in draw order */
  images: (Rect & { img: CanvasImageSource })[];
  /** grid lines canvas (when the grid is on) */
  grid: (Rect & { canvas: CanvasImageSource }) | null;
  gridLabels: (Rect & { text: string })[];
  /** the element vectors (one shared Leaflet canvas) */
  vectors: (Rect & { canvas: CanvasImageSource })[];
  /** marker glyphs (SVG → image), a loot marker's item icon over it, and label pills */
  markers: (Rect & {
    img: CanvasImageSource;
    icon?: (Rect & { img: CanvasImageSource }) | null;
    label: (Rect & { text: string }) | null;
  })[];
  /** text labels: pill + text */
  texts: (Rect & { text: string; color: string; fontPx: number })[];
  footer: string;
}

export const FOOTER_PX = 24;
const FOOTER_BG = '#0B0F14';
const FOOTER_FG = '#F2A900';
const PILL_BG = 'rgba(0, 0, 0, 0.6)';

/** The draw calls a composite needs (a real 2D context, or a recorder in tests). */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | 'drawImage'
  | 'fillRect'
  | 'fillText'
  | 'save'
  | 'restore'
  | 'scale'
  | 'beginPath'
  | 'roundRect'
  | 'fill'
  | 'measureText'
> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

function pill(ctx: Ctx, r: Rect) {
  ctx.fillStyle = PILL_BG;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fill();
}

/**
 * Draws a composite: background → tiles → grid → elements → markers → text → footer. The
 * footer overlays the bottom strip, so the image stays exactly viewport × scale.
 */
export function composeExport(ctx: Ctx, s: ExportSources): void {
  ctx.save();
  ctx.scale(s.scale, s.scale);
  ctx.fillStyle = FOOTER_BG;
  ctx.fillRect(0, 0, s.width, s.height);
  for (const i of s.images) ctx.drawImage(i.img, i.x, i.y, i.w, i.h);
  if (s.grid) ctx.drawImage(s.grid.canvas, s.grid.x, s.grid.y, s.grid.w, s.grid.h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const l of s.gridLabels) {
    pill(ctx, l);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '600 11px sans-serif';
    ctx.fillText(l.text, l.x + l.w / 2, l.y + l.h / 2);
  }
  for (const v of s.vectors) ctx.drawImage(v.canvas, v.x, v.y, v.w, v.h);
  for (const m of s.markers) {
    ctx.drawImage(m.img, m.x, m.y, m.w, m.h);
    if (m.icon) ctx.drawImage(m.icon.img, m.icon.x, m.icon.y, m.icon.w, m.icon.h);
    if (m.label) {
      pill(ctx, m.label);
      ctx.fillStyle = '#F8FAFC';
      ctx.font = '600 11px sans-serif';
      ctx.fillText(m.label.text, m.label.x + m.label.w / 2, m.label.y + m.label.h / 2);
    }
  }
  for (const t of s.texts) {
    pill(ctx, t);
    ctx.fillStyle = t.color;
    ctx.font = `600 ${t.fontPx}px sans-serif`;
    ctx.fillText(t.text, t.x + t.w / 2, t.y + t.h / 2);
  }
  ctx.fillStyle = FOOTER_BG;
  ctx.fillRect(0, s.height - FOOTER_PX, s.width, FOOTER_PX);
  ctx.fillStyle = FOOTER_FG;
  ctx.textAlign = 'left';
  ctx.font = '600 12px sans-serif';
  ctx.fillText(s.footer, 8, s.height - FOOTER_PX / 2);
  ctx.restore();
}

/** The DOM nodes that make up the picture — and nothing else (cursors, laser, selection …). */
export function selectExportNodes(
  container: HTMLElement,
  variant: 'labels' | 'clean',
  gridOn: boolean,
) {
  const q = <T extends Element>(sel: string) => [...container.querySelectorAll<T>(sel)];
  return {
    placeholder: q<HTMLImageElement>('.leaflet-placeholder-pane img'),
    tiles: q<HTMLImageElement>(`.tiles-${variant} img.leaflet-tile-loaded`),
    grid: gridOn
      ? (container.querySelector<HTMLCanvasElement>('.leaflet-grid-pane canvas') ?? null)
      : null,
    gridLabels: gridOn
      ? [
          ...(
            container.closest('[data-testid="map-canvas"]') ?? container
          ).querySelectorAll<HTMLElement>('[data-testid="grid-labels"] span'),
        ]
      : [],
    vectors: q<HTMLCanvasElement>('.leaflet-elements-pane canvas'),
    markers: q<HTMLElement>('.leaflet-marker-pane .rl-marker-icon'),
    texts: q<HTMLElement>('.leaflet-marker-pane .rl-text-icon .rl-text'),
  };
}

/** `Team Soul` → `team-soul` (ASCII, hyphens; never empty). */
export function slug(value: string): string {
  const s = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'board';
}

/** `{room-slug}_{board-slug}_{YYYY-MM-DD}.png` (FEATURES F12). */
export function exportFileName(room: string, board: string, date: Date): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${slug(room)}_${slug(board)}_${d}.png`;
}

/** room · board · map · date · credit (FEATURES F12). */
export function footerText(parts: {
  room: string;
  board: string;
  map: string;
  date: Date;
  credit: string;
}) {
  return [parts.room, parts.board, parts.map, parts.date.toLocaleDateString(), parts.credit].join(
    ' · ',
  );
}

function rectIn(el: Element, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

function svgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return img.decode().then(() => img);
}

/** Gathers the sources from the live map DOM. */
export async function collectExportSources(
  container: HTMLElement,
  opts: { variant: 'labels' | 'clean'; gridOn: boolean; footer: string; dpr: number },
): Promise<ExportSources> {
  const origin = container.getBoundingClientRect();
  const nodes = selectExportNodes(container, opts.variant, opts.gridOn);
  const markers = await Promise.all(
    nodes.markers.map(async (icon) => {
      const svg = icon.querySelector('svg');
      const labelEl = icon.querySelector<HTMLElement>('.rl-marker-label');
      const loot = icon.querySelector<HTMLImageElement>('img.rl-loot-icon');
      if (!svg) return null;
      return {
        ...rectIn(svg, origin),
        img: await svgImage(svg),
        // only a loaded icon (CORS-clean: crossOrigin=anonymous) — else the crate stays alone
        icon:
          loot?.complete && loot.naturalWidth > 0 ? { ...rectIn(loot, origin), img: loot } : null,
        label: labelEl?.textContent
          ? { ...rectIn(labelEl, origin), text: labelEl.textContent }
          : null,
      };
    }),
  );
  return {
    width: container.clientWidth,
    height: container.clientHeight,
    scale: Math.min(2, Math.max(1, opts.dpr)),
    images: [...nodes.placeholder, ...nodes.tiles].map((img) => ({ ...rectIn(img, origin), img })),
    grid: nodes.grid ? { ...rectIn(nodes.grid, origin), canvas: nodes.grid } : null,
    gridLabels: nodes.gridLabels.map((el) => ({ ...rectIn(el, origin), text: el.textContent })),
    vectors: nodes.vectors.map((canvas) => ({ ...rectIn(canvas, origin), canvas })),
    markers: markers.filter((m): m is NonNullable<typeof m> => m !== null),
    texts: nodes.texts.map((el) => {
      const style = getComputedStyle(el);
      return {
        ...rectIn(el, origin),
        text: el.textContent,
        color: style.color,
        fontPx:
          parseFloat(style.fontSize) * (el.getBoundingClientRect().height / (el.offsetHeight || 1)),
      };
    }),
    footer: opts.footer,
  };
}

/** Composite → PNG blob at viewport × scale. */
export async function renderExport(s: ExportSources): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(s.width * s.scale);
  canvas.height = Math.round(s.height * s.scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  composeExport(ctx, s);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Export failed'));
    }, 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
