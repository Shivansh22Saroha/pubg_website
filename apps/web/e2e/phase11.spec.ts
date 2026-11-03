import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  debugCount,
  debugPending,
  pageApi,
  registerViaUi,
  serveFixtureTiles,
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
