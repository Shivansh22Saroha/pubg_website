import { expect, test, type Page } from '@playwright/test';
import { debugCount, debugPending, openLeftPanel, twoUsersInRoom } from './fixtures';

/**
 * Plan tools (FEATURES F24, room redesign release 3): the quick marker drop ring, route options
 * with the compass bar, and plan replay — all on a board drawn with real mouse input.
 */
type XY = [number, number];

async function at(p: Page, fx: number, fy: number): Promise<XY> {
  const b = await p.locator('.leaflet-container').boundingBox();
  if (!b) throw new Error('no map');
  return [b.x + b.width * fx, b.y + b.height * fy];
}

async function drag(p: Page, from: XY, to: XY) {
  await p.mouse.move(...from);
  await p.mouse.down();
  await p.mouse.move(...to, { steps: 10 });
  await p.mouse.up();
}

const elements = (p: Page) => p.evaluate(() => window.__rlDebug?.elements() ?? []);
const markersOnMap = (p: Page) => p.locator('.leaflet-container .rl-marker').count();

test('E2E-R4: quick marker drop, route options + compass, plan replay', async ({ browser }) => {
  test.setTimeout(60_000);
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await a.setViewportSize({ width: 1440, height: 900 });

  // two routes: one heading east, one heading north
  await a.keyboard.press('a');
  await drag(a, await at(a, 0.3, 0.42), await at(a, 0.55, 0.42));
  await drag(a, await at(a, 0.4, 0.8), await at(a, 0.4, 0.55));
  await a.keyboard.press('v');

  // right-click an empty spot → the ring → Enemy squad lands there, for the teammate too
  const spot = await at(a, 0.5, 0.65);
  await a.mouse.click(...spot, { button: 'right' });
  const ring = a.getByTestId('radial-menu');
  // the ring's root is a zero-size anchor at the pointer; its chips are what show
  await expect(ring.getByRole('menuitem').first()).toBeVisible();
  await expect(ring.getByRole('menuitem')).toHaveCount(6);
  await ring.getByRole('menuitem', { name: 'Enemy squad' }).click();
  await expect(ring).toHaveCount(0);
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(3);
  const marker = (await elements(a)).find((e) => e.type === 'MARKER');
  expect(marker?.props).toMatchObject({ kind: 'enemy_squad', number: 1 });
  // Esc closes the ring without dropping anything
  await a.mouse.click(...spot, { button: 'right' });
  await expect(ring.getByRole('menuitem').first()).toBeVisible();
  await a.keyboard.press('Escape');
  await expect(ring).toHaveCount(0);
  expect(await debugCount(a)).toBe(3);

  // the left panel (desktop): two route options, oldest first
  await openLeftPanel(a);
  const options = a.getByTestId('route-option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText('Plan A');
  await expect(options.nth(0)).toContainText('heads 90° E');
  await expect(options.nth(1)).toContainText('heads 0° N');

  // pick Plan B: the compass bar shows its heading; × clears it
  await options.nth(1).click();
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true');
  const compass = a.getByTestId('compass-bar');
  await expect(compass).toBeVisible();
  await expect(compass).toHaveAttribute('data-bearing', '0');
  await expect(compass).toContainText('Plan B');
  await options.nth(0).click();
  await expect(compass).toHaveAttribute('data-bearing', '90');
  await compass.getByRole('button', { name: 'Clear route' }).click();
  await expect(compass).toHaveCount(0);

  // replay: scrub to the first drawing — the marker (made last) leaves the map, then comes back
  expect(await markersOnMap(a)).toBe(1);
  await a.getByTestId('tab-replay').click();
  await a.getByTestId('replay-scrub').fill('1');
  await expect(a.getByTestId('replay-banner')).toBeVisible();
  await expect(a.getByTestId('replay-count')).toHaveText('1/3');
  await expect.poll(() => markersOnMap(a)).toBe(0);
  await a.getByTestId('replay-exit').click();
  await expect(a.getByTestId('replay-banner')).toHaveCount(0);
  await expect.poll(() => markersOnMap(a)).toBe(1);

  // play from the start: it runs through and ends with everything shown
  await a.getByTestId('replay-play').click();
  await expect(a.getByTestId('replay-banner')).toBeVisible();
  await expect(a.getByTestId('replay-banner')).toHaveCount(0, { timeout: 8000 });
  await expect(a.getByTestId('replay-count')).toHaveText('3/3');
  expect(await markersOnMap(a)).toBe(1);
  // nothing was saved by any of it
  expect(await debugCount(b)).toBe(3);

  await ctxA.close();
  await ctxB.close();
});
