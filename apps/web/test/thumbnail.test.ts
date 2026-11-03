import type { Element, Layer } from '@rotationlab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { emitLocalEdit, onLocalEdit } from '@/lib/localEdits';
import { drawThumbnail, encodeJpeg, thumbnailOrder, type ThumbCtx } from '@/lib/thumbnail';

const BOARD = '0192f7a1-0000-7000-8000-000000000001';
const layer = (id: string, position: number, visible = true): Layer => ({
  id,
  boardId: BOARD,
  name: id,
  color: '#F2A900',
  position,
  visible,
  locked: false,
  seq: 1,
});
const el = (
  id: string,
  layerId: string,
  type: Element['type'],
  geometry: Record<string, unknown>,
  extra: Partial<Element> = {},
): Element => ({
  id,
  boardId: BOARD,
  layerId,
  type,
  geometry,
  style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0.3 },
  props: {},
  z: 0,
  seq: 1,
  createdBy: null,
  updatedBy: null,
  updatedAt: '2026-11-03T10:00:00.000Z',
  ...extra,
});

const show = (a: unknown): string =>
  typeof a === 'number'
    ? a.toFixed(1)
    : typeof a === 'string' || typeof a === 'boolean'
      ? String(a)
      : 'obj';

/** records every call and property write */
function recorder() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get: (_t, key: string) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push(`${key}(${args.map(show).join(',')})`);
          },
    set: (_t, key: string, v: unknown) => {
      target[key] = v;
      calls.push(`${key}=${show(v)}`);
      return true;
    },
  }) as unknown as ThumbCtx;
  return { ctx, calls };
}

describe('board thumbnails (Phase 11)', () => {
  const layers = [layer('top', 2), layer('bottom', 0), layer('hidden', 1, false)];

  it('draws visible layers bottom → top, then z; hidden layers are left out', () => {
    const els = [
      el('a', 'top', 'MARKER', { at: [0, 0] }),
      el('b', 'bottom', 'MARKER', { at: [0, 0] }, { z: 5 }),
      el('c', 'bottom', 'MARKER', { at: [0, 0] }, { z: 1 }),
      el('d', 'hidden', 'MARKER', { at: [0, 0] }),
    ];
    expect(thumbnailOrder(els, layers).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('maps world units onto 256 px and draws background, shapes and arrow heads', () => {
    const { ctx, calls } = recorder();
    drawThumbnail(ctx, {
      worldSize: 816_000,
      background: {} as CanvasImageSource,
      layers,
      elements: [
        el('line', 'bottom', 'ARROW', {
          points: [
            [0, 0],
            [408_000, 408_000],
          ],
        }),
        el('zone', 'bottom', 'CIRCLE', { center: [408_000, 408_000], r: 102_000 }),
        el('note', 'bottom', 'TEXT', { at: [1, 1] }),
      ],
    });
    expect(calls).toContain('fillRect(0.0,0.0,256.0,256.0)');
    expect(calls).toContain('drawImage(obj,0.0,0.0,256.0,256.0)');
    expect(calls).toContain('lineTo(128.0,128.0)'); // the arrow's end, at the centre
    expect(calls).toContain('arc(128.0,128.0,32.0,0.0,6.3)'); // r 102 000 cm = 32 px
    expect(calls.filter((c) => c === 'closePath()')).toHaveLength(1); // one head
    expect(calls).toContain('globalAlpha=0.3'); // the circle's fill
  });

  it('a double-headed arrow gets a head at both ends', () => {
    const { ctx, calls } = recorder();
    drawThumbnail(ctx, {
      worldSize: 816_000,
      background: null,
      layers,
      elements: [
        el(
          'two',
          'bottom',
          'ARROW',
          {
            points: [
              [0, 0],
              [408_000, 408_000],
            ],
          },
          { props: { doubleHeaded: true } },
        ),
      ],
    });
    expect(calls.filter((c) => c === 'closePath()')).toHaveLength(2);
    expect(calls.some((c) => c.startsWith('drawImage'))).toBe(false);
  });

  it('steps JPEG quality down until it fits in 100 KB, else gives up', async () => {
    const sizes: Record<number, number> = { 0.8: 150_000, 0.65: 90_000, 0.5: 50_000 };
    const toBlob = vi.fn((q: number) => Promise.resolve(new Blob([new Uint8Array(sizes[q] ?? 0)])));
    expect((await encodeJpeg(toBlob))?.size).toBe(90_000);
    expect(toBlob.mock.calls.map((c) => c[0])).toEqual([0.8, 0.65]);
    const huge = () => Promise.resolve(new Blob([new Uint8Array(200_000)]));
    expect(await encodeJpeg(huge)).toBeNull();
  });

  it('local edits notify listeners until unsubscribed', () => {
    const seen: string[] = [];
    const off = onLocalEdit((b) => seen.push(b));
    emitLocalEdit('x');
    off();
    emitLocalEdit('y');
    expect(seen).toEqual(['x']);
  });
});

describe('api() raw bodies', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a Blob as-is with its content type and the CSRF header', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ thumbnailUrl: '/x.jpg' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await api('/boards/b/thumbnail', { method: 'PUT', raw: { data: blob, type: 'image/jpeg' } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(blob);
    expect(init.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'x-requested-with': 'rotationlab',
    });
  });
});
