import { expect, test, type Page } from '@playwright/test';
import { pageApi, registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * Room redesign, release 1 (FEATURES F22): the map fills the screen, the chrome floats over it,
 * and Full map (button or H) hides the top bar and side panel. The map's own overlays keep clear
 * of whatever chrome is showing.
 */
async function openRoom(page: Page) {
  await serveFixtureTiles(page);
  await registerViaUi(page, uniqueName('glass'));
  const { room } = await pageApi<{ room: { id: string } }>(page, 'POST', '/rooms', {
    name: `Glass ${Date.now().toString(36)}`,
    firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
  });
  await page.goto(`/rooms/${room.id}`);
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
}

const right = async (page: Page, testId: string) => {
  const b = await page.getByTestId(testId).boundingBox();
  return b ? b.x + b.width : -1;
};

test('E2E-R1: full-screen map, Full map hides the panels, H brings them back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoom(page);
  const panel = page.getByRole('complementary', { name: 'Room panel' });
  const map = page.getByRole('main', { name: 'Map' });

  // the map runs under the floating chrome, edge to edge
  const box = await map.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('toolbar')).toBeVisible();

  // the HUD's right end stays left of the side panel
  const panelBox = await panel.boundingBox();
  expect(await right(page, 'map-hud')).toBeLessThanOrEqual((panelBox?.x ?? 0) + 1);
  // grid letters sit inside the clear area, below the top bar and right of the tools
  const firstCol = await page.getByTestId('grid-labels').locator('span').first().boundingBox();
  expect(firstCol?.y ?? 0).toBeGreaterThanOrEqual(72);
  expect(firstCol?.x ?? 0).toBeGreaterThanOrEqual(80);

  // Full map: top bar and side panel go, tools stay, the pill takes the corner
  await page.getByTestId('fullmap-toggle').click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('room-name')).toBeHidden();
  await expect(page.getByTestId('toolbar')).toBeVisible();
  await expect(page.getByTestId('fullmap-exit')).toBeVisible();
  await expect.poll(() => right(page, 'map-hud')).toBeGreaterThan(1400);

  // H toggles it back; ] also returns from Full map
  await page.locator('body').press('h');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('room-name')).toBeVisible();
  await page.locator('body').press('h');
  await expect(panel).toHaveCount(0);
  await page.locator('body').press(']');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('fullmap-exit')).toHaveCount(0);
});

test('E2E-R2: phone — Full map view hides the top bar and comes back', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await openRoom(page);
  await page.getByTestId('room-menu').tap();
  await page.getByRole('menuitem', { name: 'Full map view' }).tap();
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toBeHidden();
  await page.getByTestId('fullmap-exit').tap();
  await expect(page.getByRole('link', { name: 'Back to dashboard' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx.close();
});
