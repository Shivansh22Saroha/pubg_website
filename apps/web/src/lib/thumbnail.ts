import { THUMBNAIL, type Element, type Layer } from '@rotationlab/shared';

/**
 * Board thumbnails (Phase 11, FEATURES F4): a 256×256 JPEG of the whole map ("fit view") —
 * the map's low-res image with the board's visible elements drawn on top at thumbnail scale.
 * Drawn from the board model, not from the live map, so it never depends on where the user
 * has panned. Text labels are left out (unreadable at this size); markers are coloured dots.
 */

type Pt = [number, number];

/** the draw calls the thumbnail needs (a real 2D context, or a recorder in tests) */
export type ThumbCtx = Pick<
  CanvasRenderingContext2D,
  | 'drawImage'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'setLineDash'
  | 'save'
  | 'restore'
> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  lineWidth: number;
  globalAlpha: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
};

const BG = '#0B0F14';

const pts = (g: Record<string, unknown>): Pt[] =>
  Array.isArray(g.points) ? (g.points as Pt[]) : [];
const at = (g: Record<string, unknown>): Pt | null => (Array.isArray(g.at) ? (g.at as Pt) : null);

/** visible layers bottom → top, then z: the order the room renders in */
export function thumbnailOrder(elements: readonly Element[], layers: readonly Layer[]): Element[] {
  const pos = new Map(layers.filter((l) => l.visible).map((l) => [l.id, l.position]));
  return elements
    .filter((e) => pos.has(e.layerId))
    .sort((a, b) => (pos.get(a.layerId) ?? 0) - (pos.get(b.layerId) ?? 0) || a.z - b.z);
}

function arrowHead(ctx: ThumbCtx, from: Pt, to: Pt, size: number) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(ang - 0.5), to[1] - size * Math.sin(ang - 0.5));
  ctx.lineTo(to[0] - size * Math.cos(ang + 0.5), to[1] - size * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
}

export function drawThumbnail(
  ctx: ThumbCtx,
  opts: {
    worldSize: number;
    background: CanvasImageSource | null;
    elements: readonly Element[];
    layers: readonly Layer[];
    size?: number;
  },
): void {
  const size = opts.size ?? THUMBNAIL.size;
  const k = size / opts.worldSize;
  const p = ([x, y]: Pt): Pt => [x * k, y * k];
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);
  if (opts.background) ctx.drawImage(opts.background, 0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const e of thumbnailOrder(opts.elements, opts.layers)) {
    const { color, width, dashed, fillOpacity } = e.style;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, width * 0.5);
    ctx.setLineDash(dashed ? [3, 2] : []);
    ctx.globalAlpha = 1;
    const g = e.geometry;
    switch (e.type) {
      case 'STROKE':
      case 'LINE':
      case 'ARROW':
      case 'POLYGON': {
        const list = pts(g).map(p);
        const [first, ...rest] = list;
        if (!first) break;
        ctx.beginPath();
        ctx.moveTo(first[0], first[1]);
        for (const q of rest) ctx.lineTo(q[0], q[1]);
        if (e.type === 'POLYGON') {
          ctx.closePath();
          if (fillOpacity > 0) {
            ctx.globalAlpha = fillOpacity;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        ctx.stroke();
        if (e.type === 'ARROW' && list.length >= 2) {
          ctx.setLineDash([]);
          const n = list.length;
          const head = ctx.lineWidth * 3 + 2;
          arrowHead(ctx, list[n - 2] as Pt, list[n - 1] as Pt, head);
          if (e.props.doubleHeaded === true) arrowHead(ctx, list[1] as Pt, first, head);
        }
        break;
      }
      case 'CIRCLE': {
        const c = Array.isArray(g.center) ? p(g.center as Pt) : null;
        if (!c || typeof g.r !== 'number') break;
        ctx.beginPath();
        ctx.arc(c[0], c[1], Math.max(1, g.r * k), 0, Math.PI * 2);
        if (fillOpacity > 0) {
          ctx.globalAlpha = fillOpacity;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
        break;
      }
      case 'MARKER': {
        const m = at(g);
        if (!m) break;
        const [x, y] = p(m);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case 'TEXT':
        break;
    }
  }
  ctx.restore();
}

/** JPEG ≤ 100 KB: quality steps down until it fits (a 256 px map is ~15–30 KB at 0.8). */
export async function encodeJpeg(
  toBlob: (quality: number) => Promise<Blob | null>,
): Promise<Blob | null> {
  for (const q of [THUMBNAIL.quality, 0.65, 0.5]) {
    const blob = await toBlob(q);
    if (blob && blob.size <= THUMBNAIL.maxBytes) return blob;
  }
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // CDN tiles must not taint the canvas (DEPLOYMENT §4)
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve(null); // no background: elements on the dark map colour
    };
    img.src = src;
  });
}

/** Renders the thumbnail in the browser. */
export async function renderThumbnail(opts: {
  backgroundUrl: string;
  worldSize: number;
  elements: readonly Element[];
  layers: readonly Layer[];
}): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL.size;
  canvas.height = THUMBNAIL.size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawThumbnail(ctx, { ...opts, background: await loadImage(opts.backgroundUrl) });
  return encodeJpeg(
    (q) =>
      new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', q);
      }),
  );
}
