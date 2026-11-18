import { devices, expect, test, type Page } from '@playwright/test';
import { pageApi, registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * Vehicle spawns (2026-11): a toggle next to Grid, per-kind filters, remembered per device,
 * "no data yet" for maps without a file. The data comes from a fixture here — the real files
 * are generated from the PUBG API by packages/vehicle-spawns.
 */
const FIXTURE = {
  mapId: 'erangel',
  source: 'pubg-api',
  shard: 'steam',
  generatedAt: '2026-11-18T12:00:00.000Z',
  matches: 12,
  spawns: [
    { x: 300_000, y: 300_000, kind: 'car', seen: 5 },
    { x: 320_000, y: 310_000, kind: 'car', seen: 3 },
    { x: 410_000, y: 420_000, kind: 'bike', seen: 2 },
    { x: 150_000, y: 600_000, kind: 'boat', seen: 4 },
    { x: 500_000, y: 200_000, kind: 'glider', seen: 2 },
  ],
};

async function serveSpawns(page: Page) {
  await page.route('**/spawns/*.json', async (route) => {
    const map = new URL(route.request().url()).pathname.split('/').pop();
    if (map === 'erangel.json')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FIXTURE),
      });
    else await route.fulfill({ status: 404, body: 'not found' });
  });
}

async function roomWithBoards(page: Page) {
  await serveFixtureTiles(page);
  await serveSpawns(page);
  await registerViaUi(page, uniqueName('veh'));
  const { room } = await pageApi<{ room: { id: string } }>(page, 'POST', '/rooms', {
    name: `Vehicles ${Date.now().toString(36)}`,
    firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
  });
  await pageApi(page, 'POST', `/rooms/${room.id}/boards`, {
    name: 'Miramar – Plan 2',
    mapId: 'miramar',
  });
  await page.goto(`/rooms/${room.id}`);
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  return room.id;
}

const layerCount = (page: Page) =>
  page.getByTestId('vehicle-layer').getAttribute('data-count').then(Number);

test('vehicle spawns: toggle, filter by kind, remembered after reload, "no data" on other maps', async ({
  page,
}) => {
  await roomWithBoards(page);
  const toggle = page.getByTestId('vehicles-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('vehicle-layer')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => layerCount(page)).toBe(5);

  // hide cars from the filter panel; counts per kind come from the file
  await page.getByTestId('vehicles-filter').click();
  const panel = page.getByTestId('vehicles-panel');
  await expect(panel).toContainText('Cars');
  await expect(panel).toContainText('12 matches');
  await panel.getByTestId('vehicles-kind-car').click();
  await expect.poll(() => layerCount(page)).toBe(3);
  await page.keyboard.press('Escape');

  // per device: still on, cars still hidden after a reload
  await page.reload();
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  await expect(page.getByTestId('vehicles-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => layerCount(page)).toBe(3);

  // a map without a file: no layer, and the panel says so
  await page.getByRole('tab', { name: /Miramar – Plan 2/ }).click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map', 'miramar');
  await expect(page.getByTestId('vehicle-layer')).toHaveCount(0);
  await page.getByTestId('vehicles-filter').click();
  await expect(page.getByTestId('vehicles-panel')).toContainText('No spawn data for this map yet');
  await page.keyboard.press('Escape');

  // off again: the layer goes away
  await page.getByTestId('vehicles-toggle').click();
  await expect(page.getByTestId('vehicles-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('vehicle spawns on a phone: the HUD fits and the layer shows', async ({ browser }) => {
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  await roomWithBoards(page);
  await page.getByTestId('vehicles-toggle').tap();
  await expect.poll(() => layerCount(page)).toBe(5);
  await expect(page.getByTestId('vehicles-filter')).toBeVisible();
  // no horizontal scroll from the extra HUD buttons
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const fit = await page.getByRole('button', { name: 'Fit map' }).boundingBox();
  expect(fit && fit.x + fit.width).toBeLessThanOrEqual(390);
  await ctx.close();
});
