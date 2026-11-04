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

  // layout: fits the side panel — no horizontal overflow, actions never cover the text
  expect(await list.evaluate((t) => t.scrollWidth <= (t.parentElement?.clientWidth ?? 0))).toBe(
    true,
  );
  const row = list.locator('tbody tr').first();
  const text = await row.locator('td').first().boundingBox();
  const action = await show.boundingBox();
  if (!text || !action) throw new Error('no row layout');
  expect(action.x).toBeGreaterThanOrEqual(text.x + text.width - 1);
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

test('curved arrow: style-bar toggle, synced, and selecting it flips it back as one undo step', async ({
  browser,
}) => {
  const { a, b, ctxA, ctxB } = await twoUsersInRoom(browser);
  const box = await a.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  const at = (fx: number, fy: number) =>
    [box.x + box.width * fx, box.y + box.height * fy] as [number, number];
  const arrows = (p: Page) =>
    p.evaluate(() => window.__rlDebug?.elements().filter((e) => e.type === 'ARROW') ?? []);

  await a.keyboard.press('a');
  const toggle = a.getByTestId('style-bar').getByRole('button', { name: 'Curved' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // click start, a bend, the end; Enter finishes
  await a.mouse.click(...at(0.25, 0.6));
  await a.mouse.click(...at(0.4, 0.35));
  await a.mouse.click(...at(0.55, 0.6));
  await a.keyboard.press('Enter');
  await expect.poll(async () => (await arrows(b))[0]?.props).toEqual({ curved: true });

  // the curve passes through its bend point, so a click there selects it
  await expect.poll(() => debugPending(a)).toBe(0);
  await a.keyboard.press('v');
  await a.mouse.click(...at(0.4, 0.35));
  const sel = a.getByTestId('style-bar').getByRole('button', { name: 'Curved' });
  await expect(sel).toHaveAttribute('aria-pressed', 'true');
  await sel.click();
  await expect.poll(async () => (await arrows(b))[0]?.props).toEqual({});
  await a.keyboard.press('Escape');
  await expect.poll(() => debugPending(a)).toBe(0);
  await a.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(async () => (await arrows(b))[0]?.props).toEqual({ curved: true });
  await ctxA.close();
  await ctxB.close();
});

test('loot marker: pick Loot + an item, the icon shows for everyone; a missing icon falls back to the crate', async ({
  browser,
}) => {
  const { a, b, ctxA, ctxB } = await twoUsersInRoom(browser);
  const box = await a.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  const loaded = (p: Page) =>
    p
      .locator('img.rl-loot-icon')
      .evaluateAll((imgs) =>
        (imgs as HTMLImageElement[])
          .filter((i) => i.complete && i.naturalWidth > 0)
          .map((i) => new URL(i.src).pathname),
      );

  // marker flyout → Loot, then the item in the style bar
  await a.getByTestId('tool-marker').click(); // opens the kind flyout
  await a.getByTestId('marker-kind-loot').click();
  await a.getByTestId('loot-item').selectOption('awm');
  await a.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  await expect.poll(() => loaded(b)).toEqual(['/tiles/icons/items/awm.webp']);
  await expect.poll(() => loaded(a)).toEqual(['/tiles/icons/items/awm.webp']);
  const props = await b.evaluate(
    () => window.__rlDebug?.elements().find((e) => e.type === 'MARKER')?.props,
  );
  expect(props).toEqual({ kind: 'loot', item: 'awm' });

  // switch the item on the selected marker → smoke grenade has no fixture icon: the crate stays
  await expect.poll(() => debugPending(a)).toBe(0);
  await a.keyboard.press('v');
  await a.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await a.getByTestId('style-bar').getByTestId('loot-item').selectOption('smoke_grenade');
  await expect
    .poll(() => b.evaluate(() => window.__rlDebug?.elements()[0]?.props))
    .toEqual({ kind: 'loot', item: 'smoke_grenade' });
  await expect(b.locator('img.rl-loot-icon')).toHaveCount(0);
  await expect(b.locator('.rl-marker svg rect')).toHaveCount(1);
  await ctxA.close();
  await ctxB.close();
});
