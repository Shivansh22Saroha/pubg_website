import { devices, expect, test, type Page } from '@playwright/test';
import { pageApi, registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * Recall towers (2026-11): green hearts on maps that have recall data, shown by default, a
 * Recalls toggle next to Grid that hides / shows them all (remembered per device), and no toggle
 * at all on maps without data. The data comes from a fixture here — the real files are
 * generated from the PUBG API by packages/vehicle-spawns.
 */
const FIXTURE = {
  mapId: 'rondo',
  source: 'pubg-api',
  shard: 'steam',
  generatedAt: '2026-11-20T04:20:40.751Z',
  matches: 400,
  towers: [
    { x: 482_594, y: 375_383, seen: 94 },
    { x: 293_977, y: 448_527, seen: 79 },
    { x: 282_912, y: 243_534, seen: 58 },
  ],
};

async function serveData(page: Page) {
  await page.route('**/recalls/*.json', async (route) => {
    const map = new URL(route.request().url()).pathname.split('/').pop();
    if (map === 'rondo.json')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FIXTURE),
      });
    else await route.fulfill({ status: 404, body: 'not found' });
  });
  await page.route('**/spawns/*.json', (route) => route.fulfill({ status: 404, body: '' }));
}

async function roomWithBoards(page: Page) {
  await serveFixtureTiles(page);
  await serveData(page);
  await registerViaUi(page, uniqueName('rec'));
  const { room } = await pageApi<{ room: { id: string } }>(page, 'POST', '/rooms', {
    name: `Recalls ${Date.now().toString(36)}`,
    firstBoard: { name: 'Rondo – Plan 1', mapId: 'rondo' },
  });
  await pageApi(page, 'POST', `/rooms/${room.id}/boards`, {
    name: 'Erangel – Plan 2',
    mapId: 'erangel',
  });
  await page.goto(`/rooms/${room.id}`);
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  return room.id;
}

const layerCount = (page: Page) =>
  page.getByTestId('recall-layer').getAttribute('data-count').then(Number);

test('recalls: on by default on Rondo, toggle hides all, remembered, no toggle on other maps', async ({
  page,
}) => {
  await roomWithBoards(page);
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map', 'rondo');
  const toggle = page.getByTestId('recalls-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => layerCount(page)).toBe(3);
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-recalls', 'on');

  // hide them all
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('recall-layer')).toHaveCount(0);

  // per device: still hidden after a reload, then shown again
  await page.reload();
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  await expect(page.getByTestId('recalls-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('recall-layer')).toHaveCount(0);
  await page.getByTestId('recalls-toggle').click();
  await expect.poll(() => layerCount(page)).toBe(3);

  // a map without recall data: no toggle, no layer, and its file isn't even requested
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/recalls/')) asked.push(r.url());
  });
  await page.getByRole('tab', { name: /Erangel – Plan 2/ }).click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map', 'erangel');
  await expect(page.getByTestId('recalls-toggle')).toHaveCount(0);
  await expect(page.getByTestId('recall-layer')).toHaveCount(0);
  expect(asked.filter((u) => u.includes('erangel'))).toEqual([]);
});

test('recalls on a phone: the HUD still fits with vehicles on too', async ({ browser }) => {
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  await roomWithBoards(page);
  await expect.poll(() => layerCount(page)).toBe(3);
  await page.getByTestId('vehicles-toggle').tap();
  await expect(page.getByTestId('vehicles-filter')).toBeVisible();
  await expect(page.getByTestId('recalls-toggle')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const name of ['Fit map', 'Recalls']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  }
  await ctx.close();
});
