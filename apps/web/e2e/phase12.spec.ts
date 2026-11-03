import { expect, test, type Page } from '@playwright/test';
import { debugCount, pageApi, twoUsersInRoom } from './fixtures';

/** Phase 12 (P2 batch): element list location / Show, linked players, curved arrows, loot. */

const STYLE = { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 };
const uuid = () => crypto.randomUUID();

/** an element through the real socket path (the debug hook's raw emit), on the first layer */
async function addElement(
  page: Page,
  boardId: string,
  el: { type: string; geometry: unknown; props?: unknown },
): Promise<string> {
  const id = uuid();
  const res = await page.evaluate(
    async ({ id, boardId, el, style, opId }) => {
      const layer = window.__rlDebug?.layers().find((l) => !l.locked);
      return window.__rlDebug?.emit('element:upsert', {
        opId,
        boardId,
        element: { id, boardId, layerId: layer?.id, style, props: {}, ...el },
      });
    },
    { id, boardId, el, style: STYLE, opId: uuid() },
  );
  expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  return id;
}

const center = async (p: Page) =>
  ((await p.getByTestId('map-canvas').getAttribute('data-center')) ?? '0,0')
    .split(',')
    .map(Number) as [number, number];

test('element list: location column and Show — viewers too', async ({ browser }) => {
  const { a, b, ctxA, ctxB, roomId, boardId } = await twoUsersInRoom(browser);
  const bId = (await pageApi<{ user: { id: string } }>(b, 'GET', '/me')).user.id;
  await pageApi(a, 'PATCH', `/rooms/${roomId}/members/${bId}`, { role: 'VIEWER' });
  await addElement(a, boardId, {
    type: 'MARKER',
    geometry: { at: [612_000, 204_000] },
    props: { kind: 'enemy_squad', number: 4, label: 'Ridge' },
  });
  await expect.poll(() => debugCount(b)).toBe(1);

  await b.getByRole('tab', { name: 'Layers' }).click();
  await b.getByTestId('layers-view-list').click();
  const list = b.getByTestId('element-list');
  await expect(list.getByTestId('element-location')).toHaveText('G-K 0,0');
  const show = list.getByRole('button', { name: /^Show Marker Enemy squad 4 Ridge at G-K 0,0/ });
  await show.click();
  await expect
    .poll(async () => {
      const [x, y] = await center(b);
      return Math.abs(x - 612_000) < 5_000 && Math.abs(y - 204_000) < 5_000;
    })
    .toBe(true);
  // a viewer can look but not edit
  await expect(list.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});
