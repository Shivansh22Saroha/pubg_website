import { expect, test, type Page } from '@playwright/test';
import { debugCount, debugPending, pageApi, twoUsersInRoom } from './fixtures';

/** Phase 12 (P2 batch): element list location / Show, linked players, curved arrows, loot. */

const STYLE = { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 };
const uuid = () => crypto.randomUUID();

/**
 * An element through the real socket path (the debug hook's raw emit), on the first layer.
 * The server doesn't echo an op to its sender, so only the *other* pages receive it.
 */
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

test('linked own-player marker: pick a member in the style bar, everyone sees their name, undo unlinks', async ({
  browser,
}) => {
  const { a, b, nameB, ctxA, ctxB, boardId } = await twoUsersInRoom(browser);
  // created by B: a raw emit isn't echoed to its sender, so A receives it like any remote op
  const id = await addElement(b, boardId, {
    type: 'MARKER',
    geometry: { at: [408_000, 408_000] },
    props: { kind: 'own_player', number: 2 },
  });
  await expect.poll(() => debugCount(a)).toBe(1);

  // select it from the element list, then link it in the style bar
  await a.getByRole('tab', { name: 'Layers' }).click();
  await a.getByTestId('layers-view-list').click();
  await a.getByRole('button', { name: /^Select Marker Own player 2/ }).click();
  const picker = a.getByTestId('player-link');
  await expect(picker).toHaveValue('');
  await picker.selectOption({ label: nameB });
  await expect
    .poll(() =>
      b.evaluate((elId) => window.__rlDebug?.elements().find((e) => e.id === elId)?.props, id),
    )
    .toMatchObject({ kind: 'own_player', number: 2, memberId: expect.any(String) });
  await expect(b.locator('.rl-marker-label')).toHaveText(nameB);
  await expect(a.locator('.rl-marker-label')).toHaveText(nameB);
  // the typed-label input is replaced by the link
  await expect(a.getByTestId('style-bar').getByRole('textbox', { name: 'Label' })).toHaveCount(0);

  await expect.poll(() => debugPending(a)).toBe(0);
  await a.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(b.locator('.rl-marker-label')).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});
