import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  debugCount,
  debugPending,
  pageApi,
  registerViaUi,
  serveFixtureTiles,
  twoUsersInRoom,
  uniqueName,
} from './fixtures';

/** Phase 11 (v1.1): share links, thumbnails, minimap, typing indicator, drawing extras. */

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

async function watchCsp(page: Page) {
  const fromConsole: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) fromConsole.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window.__cspViolations ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => [...fromConsole, ...(await page.evaluate(() => window.__cspViolations ?? []))];
}

async function seriousAxe(p: Page, what: string) {
  const result = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.leaflet-container')
    .analyze();
  const bad = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${what}: ${v.id} — ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`);
  expect(bad, bad.join('\n')).toEqual([]);
}

/** owner with a room open and synced */
async function ownerInRoom(page: Page, roomName: string) {
  await serveFixtureTiles(page);
  const name = uniqueName('own');
  await registerViaUi(page, name);
  const { room, board } = await pageApi<{ room: { id: string }; board: { id: string } }>(
    page,
    'POST',
    '/rooms',
    { name: roomName, firstBoard: { name: 'Drop plan', mapId: 'erangel' } },
  );
  await page.goto(`/rooms/${room.id}`);
  await page.waitForFunction(() => window.__rlDebug?.ready() === true);
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  return { name, roomId: room.id, boardId: board.id };
}

test('share link: create from the kebab, open read-only without login, revoke', async ({
  page,
  browser,
}) => {
  const roomName = `Secret scrims ${Date.now().toString(36)}`;
  const owner = await ownerInRoom(page, roomName);
  await page.evaluate(() => window.__rlDebug?.addRandomElements(14));
  await expect.poll(() => debugPending(page)).toBe(0);
  expect(await debugCount(page)).toBe(14);

  await page.getByRole('button', { name: 'Board actions for Drop plan' }).click();
  await page.getByRole('menuitem', { name: 'Share link…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share read-only link' });
  await expect(dialog.getByTestId('share-status')).toContainText('no share link');
  await dialog.getByTestId('share-generate').click();
  const url = await dialog.getByTestId('share-link').inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{22}$/);
  await expect(dialog.getByTestId('share-status')).toContainText('A link is active');
  await seriousAxe(page, 'share dialog');

  // an anonymous visitor
  const anon = await browser.newContext();
  const v = await anon.newPage();
  await serveFixtureTiles(v);
  const sockets: string[] = [];
  v.on('websocket', (ws) => sockets.push(ws.url()));
  v.on('request', (r) => {
    if (r.url().includes('/realtime')) sockets.push(r.url());
  });
  const violations = await watchCsp(v);
  await v.goto(new URL(url).pathname);
  await expect(v.getByTestId('shared-board-name')).toHaveText('Drop plan · Erangel');
  await expect(v.locator('.rl-marker').first()).toBeVisible();
  await expect(v.getByTestId('toolbar')).toHaveCount(0);
  // labels / grid are on the HUD; measure works
  await v.keyboard.press('r');
  await expect(v.getByTestId('shared-measure')).toHaveAttribute('aria-pressed', 'true');
  const box = await v.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  await v.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await v.mouse.dblclick(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await expect(v.locator('.rl-measure-total')).toContainText(/ m · /);
  // nothing that names the room or its people
  const html = await v.content();
  for (const secret of [roomName, owner.name, owner.roomId]) expect(html).not.toContain(secret);
  expect(await v.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
  await seriousAxe(v, '/s/[token]');
  await v.waitForTimeout(300);
  expect(sockets).toEqual([]);
  expect(await violations()).toEqual([]);

  // revoke (two clicks: confirm) → the visitor's reload says the link is gone
  await dialog.getByTestId('share-revoke').click();
  await dialog.getByTestId('share-revoke').click();
  await expect(dialog.getByTestId('share-status')).toContainText('no share link');
  await v.reload();
  await expect(v.getByTestId('shared-error')).toContainText('invalid or has expired');
  await anon.close();
});

test('share link: a malformed or unknown token shows the same message', async ({ page }) => {
  for (const path of ['/s/nope', `/s/${'A'.repeat(22)}`]) {
    await page.goto(path);
    await expect(page.getByTestId('shared-error')).toContainText('invalid or has expired');
  }
});

test('thumbnails: an edit arms the upload, the dashboard card shows the board image', async ({
  page,
}) => {
  const roomName = `Thumbs ${Date.now().toString(36)}`;
  await ownerInRoom(page, roomName);
  // nothing armed before an edit
  expect(await page.evaluate(() => window.__rlDebug?.flushThumbnail())).toBe(false);
  await page.evaluate(() => window.__rlDebug?.addRandomElements(10));
  await expect.poll(() => debugPending(page)).toBe(0);
  // the 30 s timer is armed by the edit; run it now
  expect(await page.evaluate(() => window.__rlDebug?.flushThumbnail())).toBe(true);

  await page.goto('/dashboard');
  const card = page.locator('article', { hasText: roomName });
  const img = card.locator('img').first();
  await expect(img).toHaveAttribute(
    'src',
    /\/api\/v1\/assets\/thumbnails\/[0-9a-f-]{36}\/[\w-]{22}\.jpg$/,
  );
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)))
    .toBe(256);
});

test('minimap: viewport rectangle, click / drag moves the view, collapses, hidden on phone', async ({
  page,
  browser,
}) => {
  await ownerInRoom(page, `Minimap ${Date.now().toString(36)}`);
  const minimap = page.getByTestId('minimap');
  await expect(minimap).toBeVisible();
  const surface = page.getByTestId('minimap-surface');
  await expect(surface).toHaveCSS('width', '160px');
  const viewport = page.getByTestId('minimap-viewport');
  await expect(viewport).toBeVisible();
  const canvas = page.getByTestId('map-canvas');
  const center = async () =>
    ((await canvas.getAttribute('data-center')) ?? '0,0').split(',').map(Number) as [
      number,
      number,
    ];

  // zoom well in (maxBounds would clamp a wider view), then click the top-left quarter
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  const box = await surface.boundingBox();
  if (!box) throw new Error('no minimap');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await expect
    .poll(async () => {
      const [x, y] = await center();
      return Math.abs(x - 204_000) < 15_000 && Math.abs(y - 204_000) < 15_000;
    })
    .toBe(true);
  // the rectangle follows (its centre near the click)
  const r = await viewport.boundingBox();
  if (!r) throw new Error('no viewport rect');
  expect(Math.abs(r.x + r.width / 2 - (box.x + box.width * 0.25))).toBeLessThan(6);

  // drag to the bottom-right quarter
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const [x, y] = await center();
      return Math.abs(x - 612_000) < 15_000 && Math.abs(y - 612_000) < 15_000;
    })
    .toBe(true);

  // keyboard: focus + arrow
  await surface.focus();
  const [x0] = await center();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await center())[0]).toBeLessThan(x0 - 50_000);

  // collapse, and it stays collapsed after a reload
  await minimap.getByRole('button', { name: 'Minimap' }).click();
  await expect(minimap).toHaveAttribute('data-collapsed', 'true');
  await expect(surface).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('minimap')).toHaveAttribute('data-collapsed', 'true');

  // phone: none
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await phone.newPage();
  await serveFixtureTiles(p);
  await p.goto('/explore');
  await expect(p.getByTestId('map-canvas')).toBeVisible();
  await expect(p.getByTestId('minimap')).toHaveCount(0);
  await phone.close();
});

test('typing indicator: "X is typing…" for the others, gone when the message lands or after 4 s', async ({
  browser,
}) => {
  const { a, b, nameA, ctxA, ctxB } = await twoUsersInRoom(browser);
  const indicatorB = b.getByTestId('typing-indicator');
  const input = a.getByRole('textbox', { name: 'Message' });
  await input.click();
  await input.pressSequentially('rotate ', { delay: 30 });
  await expect(indicatorB).toHaveText(`${nameA} is typing…`);
  await expect(a.getByTestId('typing-indicator')).toHaveText(''); // never yourself
  await input.press('Enter');
  await expect(b.getByTestId('chat-body').filter({ hasText: 'rotate' })).toBeVisible();
  await expect(indicatorB).toHaveText('');

  // a typist who stops: cleared ~4 s after the last event
  await a.waitForTimeout(2_100); // past the 2 s send throttle
  await input.pressSequentially('hold', { delay: 30 });
  await expect(indicatorB).toHaveText(`${nameA} is typing…`);
  const t0 = Date.now();
  await expect(indicatorB).toHaveText('', { timeout: 8_000 });
  expect(Date.now() - t0).toBeGreaterThan(2_500);
  await ctxA.close();
  await ctxB.close();
});

test('drawing extras: double-headed arrow and "Save as line" sync and undo like any element', async ({
  browser,
}) => {
  const { a, b, ctxA, ctxB } = await twoUsersInRoom(browser);
  const box = await a.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  const at = (fx: number, fy: number) =>
    [box.x + box.width * fx, box.y + box.height * fy] as [number, number];
  const ofType = (p: Page, type: string) =>
    p.evaluate((t) => window.__rlDebug?.elements().filter((e) => e.type === t) ?? [], type);
  const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

  // ---- double-headed arrow: style-bar toggle, then press-drag-release
  await a.keyboard.press('a');
  const toggle = a.getByTestId('style-bar').getByRole('button', { name: 'Double-headed' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await a.mouse.move(...at(0.3, 0.3));
  await a.mouse.down();
  await a.mouse.move(...at(0.45, 0.4), { steps: 6 });
  await a.mouse.move(...at(0.6, 0.5), { steps: 6 });
  await a.mouse.up();
  await expect.poll(async () => (await ofType(b, 'ARROW')).length).toBe(1);
  expect((await ofType(b, 'ARROW'))[0]?.props).toEqual({ doubleHeaded: true });
  await expect.poll(() => debugPending(a)).toBe(0);
  await a.keyboard.press(undoKey);
  await expect.poll(async () => (await ofType(b, 'ARROW')).length).toBe(0);
  await a.keyboard.press(redoKey);
  await expect.poll(async () => (await ofType(b, 'ARROW')).length).toBe(1);

  // toggling it on a selected arrow is one undoable edit
  await a.keyboard.press('v');
  await a.mouse.click(...at(0.45, 0.4)); // on the arrow's path
  const selToggle = a.getByTestId('style-bar').getByRole('button', { name: 'Double-headed' });
  await expect(selToggle).toHaveAttribute('aria-pressed', 'true');
  await selToggle.click();
  await expect.poll(async () => (await ofType(b, 'ARROW'))[0]?.props).toEqual({});
  await a.keyboard.press('Escape');
  await a.keyboard.press(undoKey);
  await expect
    .poll(async () => (await ofType(b, 'ARROW'))[0]?.props)
    .toEqual({
      doubleHeaded: true,
    });

  // ---- measure → Save as line (3 points → 2 lines, one undo step)
  await a.keyboard.press('r');
  await expect(a.getByTestId('measure-save')).toHaveCount(0); // nothing measured yet
  await a.mouse.click(...at(0.2, 0.7));
  await a.mouse.click(...at(0.4, 0.7));
  await a.mouse.dblclick(...at(0.4, 0.85));
  await a.getByTestId('measure-save').click();
  await expect.poll(async () => (await ofType(b, 'LINE')).length).toBe(2);
  await expect(a.locator('.rl-measure-total')).toHaveCount(0); // the local measure is cleared
  await expect.poll(() => debugPending(a)).toBe(0);
  await a.keyboard.press(undoKey);
  await expect.poll(async () => (await ofType(b, 'LINE')).length).toBe(0);
  expect((await ofType(b, 'ARROW')).length).toBe(1); // only the last step was undone
  await ctxA.close();
  await ctxB.close();
});
