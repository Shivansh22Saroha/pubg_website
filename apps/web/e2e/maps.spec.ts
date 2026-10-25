import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * E2E-10 (TESTING §6): each map loads tiles with no 404s, the labels toggle swaps the visible
 * tile URL, and the grid toggles. Tiles are served from the committed fixture set — real
 * tiles are never needed.
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tiles');
const MAPS = ['erangel', 'miramar', 'rondo'] as const;

async function serveFixtureTiles(page: Page) {
  const failed: string[] = [];
  await page.route('**/tiles/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const rel = decodeURIComponent(pathname.replace(/^.*?\/tiles\//, ''));
    const file = path.join(FIXTURES, rel);
    if (!file.startsWith(FIXTURES) || !existsSync(file)) {
      failed.push(pathname);
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      body: readFileSync(file),
      contentType: file.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    });
  });
  return failed;
}

/** src of loaded tiles in the visible (opacity 1) base layer */
function visibleTileSources(page: Page) {
  return page.$$eval('.leaflet-tile-pane > .leaflet-layer', (layers) =>
    layers
      .filter((l) => getComputedStyle(l).opacity === '1')
      .flatMap((l) => Array.from(l.querySelectorAll<HTMLImageElement>('img.leaflet-tile-loaded')))
      .map((img) => img.src),
  );
}

for (const mapId of MAPS) {
  test(`E2E-10 ${mapId}: tiles, labels toggle, grid toggle`, async ({ page }) => {
    const notFound = await serveFixtureTiles(page);
    const http404: string[] = [];
    page.on('response', (res) => {
      if (res.status() === 404) http404.push(res.url());
    });

    await page.goto(`/maps/${mapId}`);
    const canvas = page.getByTestId('map-canvas');
    await expect(canvas).toHaveAttribute('data-map', mapId);

    // tiles load
    await expect.poll(async () => (await visibleTileSources(page)).length).toBeGreaterThan(0);
    const before = await visibleTileSources(page);
    expect(before.every((src) => src.includes(`/tiles/${mapId}/labels/`))).toBe(true);

    // labels toggle via the N key → clean tiles are the visible ones, no blank frame in between
    await page.locator('.leaflet-container').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('n');
    await expect(canvas).toHaveAttribute('data-variant', 'clean');
    const after = await visibleTileSources(page);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((src) => src.includes(`/tiles/${mapId}/clean/`))).toBe(true);

    // ...and back via the HUD button
    await page.getByRole('button', { name: 'Map labels' }).click();
    await expect(canvas).toHaveAttribute('data-variant', 'labels');

    // grid toggles (lines pane + edge letters)
    const gridPane = page.locator('.leaflet-grid-pane canvas'); // panes are 0×0; the canvas has size
    await expect(gridPane).toBeVisible();
    await expect(page.getByTestId('grid-labels')).toContainText('A');
    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(canvas).toHaveAttribute('data-grid', 'off');
    await expect(gridPane).toBeHidden();
    await expect(page.getByTestId('grid-labels')).toHaveCount(0);
    await page.keyboard.press('Shift+G');
    await expect(canvas).toHaveAttribute('data-grid', 'on');
    await expect(gridPane).toBeVisible();

    // HUD shows a grid ref when hovering the map centre
    const box = await page.locator('.leaflet-container').boundingBox();
    if (!box) throw new Error('map container has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('hud-readout')).toHaveText(/^[A-H]-[I-P] \d,\d · /);

    expect(notFound, 'tile requests missing from fixtures').toEqual([]);
    expect(http404, 'HTTP 404 responses').toEqual([]);
  });
}
