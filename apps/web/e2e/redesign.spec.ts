import { expect, test, type Page } from '@playwright/test';
import { pageApi, registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * Room redesign, release 1 (FEATURES F22): the map fills the screen, the chrome floats over it,
 * and Full map (button or H) hides the side panels, compass and board switcher (exact room demo). The map's own overlays keep clear
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

  // glass layout (2026-11-21): tools in a bottom dock, route options + layers on the left
  const dock = page.getByTestId('toolbar');
  await expect(dock).toHaveAttribute('data-orientation', 'horizontal');
  const dockBox = await dock.boundingBox();
  expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeGreaterThan(880);
  expect(Math.abs((dockBox?.x ?? 0) + (dockBox?.width ?? 0) / 2 - 720)).toBeLessThan(4);
  const left = page.getByRole('complementary', { name: 'Plan panel' });
  await expect(left).toBeVisible();
  await expect(left.getByRole('heading', { name: 'Route options' })).toBeVisible();
  await expect(left.getByTestId('layer-row').first()).toBeVisible();
  await expect(page.getByTestId('board-title')).toHaveText('Erangel – Plan 1');
  // the HUD sits right of the left panel and above the dock
  const leftBox = await left.boundingBox();
  const hud = await page.getByTestId('map-hud').boundingBox();
  expect(hud?.x ?? 0).toBeGreaterThanOrEqual((leftBox?.x ?? 0) + (leftBox?.width ?? 0));
  expect((hud?.y ?? 0) + (hud?.height ?? 0)).toBeLessThanOrEqual(dockBox?.y ?? 0);
  // [ folds the left panel away (a tab stays to bring it back), and back
  await page.locator('body').press('[');
  await expect(left).toHaveCount(0);
  await page.getByTestId('left-panel-open').click();
  await expect(left).toBeVisible();

  // the HUD's right end stays left of the side panel
  const panelBox = await panel.boundingBox();
  expect(await right(page, 'map-hud')).toBeLessThanOrEqual((panelBox?.x ?? 0) + 1);
  // grid letters sit inside the clear area, below the top bar and right of the tools
  const firstCol = await page.getByTestId('grid-labels').locator('span').first().boundingBox();
  expect(firstCol?.y ?? 0).toBeGreaterThanOrEqual(72);
  expect(firstCol?.x ?? 0).toBeGreaterThanOrEqual(80);

  // exact room demo: the compass box sits top centre, the board switcher under it
  await expect(page.getByTestId('compass-bar')).toBeVisible();
  await expect(page.getByTestId('compass-bar')).toContainText('Pick a route');
  // it takes the room between the room card and the actions, never overlapping either
  const compassBox = await page.getByTestId('compass-bar').boundingBox();
  const cardBox = await page
    .getByTestId('room-name')
    .locator('xpath=ancestor::div[contains(@class,"glass-panel")][1]')
    .boundingBox();
  const moreBox = await page.getByTestId('profile-button').boundingBox();
  expect(compassBox?.x ?? 0).toBeGreaterThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0));
  expect((compassBox?.x ?? 0) + (compassBox?.width ?? 0)).toBeLessThanOrEqual(moreBox?.x ?? 0);
  expect(compassBox?.width ?? 0).toBeGreaterThan(300);
  await expect(page.getByTestId('dock-hint')).toBeVisible();

  // Full map (the demo's focus mode): compass, board switcher, hint and side panels go; the room
  // card, the actions and the tools stay, and the button now reads Show panels
  await page.getByTestId('fullmap-toggle').click();
  await expect(panel).toHaveCount(0);
  await expect(left).toHaveCount(0);
  await expect(page.getByTestId('compass-bar')).toBeHidden();
  await expect(page.getByTestId('dock-hint')).toBeHidden();
  await expect(page.getByTestId('room-name')).toBeVisible();
  await expect(page.getByTestId('toolbar')).toBeVisible();
  await expect(page.getByTestId('fullmap-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('fullmap-toggle')).toHaveAccessibleName('Show panels');
  await expect.poll(() => right(page, 'map-hud')).toBeGreaterThan(1400);

  // H toggles it back; ] also returns from Full map
  await page.locator('body').press('h');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('compass-bar')).toBeVisible();
  await page.locator('body').press('h');
  await expect(panel).toHaveCount(0);
  await page.locator('body').press(']');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('fullmap-toggle')).toHaveAttribute('aria-pressed', 'false');

  // ] folds the right panel to a vertical edge tab; the tab brings it back
  await page.locator('body').press(']');
  await expect(panel).toHaveCount(0);
  await page.getByTestId('panel-toggle').click();
  await expect(panel).toBeVisible();
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
