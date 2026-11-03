import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSharedBoard } from '@/lib/share';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string) =>
  json(status, { error: { code, message: code, requestId: 'r' } });
const TOKEN = 'AbCdEfGhIjKlMnOpQr_-12';
const BOARD = {
  board: {
    id: '0192f7a1-0000-7000-8000-000000000001',
    name: 'Drop A',
    mapId: 'miramar',
    position: 0,
    elementCount: 1,
    updatedAt: '2026-11-03T10:00:00.000Z',
  },
  layers: [],
  elements: [
    {
      id: '0192f7a1-0000-7000-8000-0000000000e1',
      boardId: '0192f7a1-0000-7000-8000-000000000001',
      layerId: '0192f7a1-0000-7000-8000-0000000000a1',
      type: 'MARKER',
      geometry: { at: [1000, 1000] },
      style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 },
      props: { kind: 'drop' },
      z: 0,
      seq: 1,
      createdBy: null,
      updatedBy: null,
      updatedAt: '2026-11-03T10:00:00.000Z',
    },
  ],
  expiresAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadSharedBoard (Phase 11)', () => {
  it('a malformed token never reaches the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadSharedBoard('../../rooms')).toEqual({ status: 'gone' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the public board to the read-only view model', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, BOARD)));
    vi.stubGlobal('fetch', fetchMock);
    const res = await loadSharedBoard(TOKEN);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/share/${TOKEN}`, expect.anything());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.board.mapId).toBe('miramar');
    expect(Object.keys(res.board.elements)).toEqual([BOARD.elements[0]!.id]);
  });

  it('404 → gone, 429 → limited, anything else → error (never a refresh loop)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(err(404, 'NOT_FOUND'))),
    );
    expect(await loadSharedBoard(TOKEN)).toEqual({ status: 'gone' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(err(429, 'RATE_LIMITED'))),
    );
    expect(await loadSharedBoard(TOKEN)).toEqual({ status: 'limited' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(err(500, 'INTERNAL'))),
    );
    expect(await loadSharedBoard(TOKEN)).toEqual({ status: 'error' });
  });
});
