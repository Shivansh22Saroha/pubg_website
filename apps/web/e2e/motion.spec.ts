import { expect, test } from '@playwright/test';
import { debugCount, debugPending, twoUsersInRoom } from './fixtures';

/**
 * Motion library (2026-11): the one suite that runs with motion on (playwright.config sets
 * reduced motion everywhere else). It checks the animations are wired to the right events,
 * and that reduced motion really turns them off.
 */
test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test("B sees A's arrow trace in and A's enemy marker flash in; A's own arrow just appears", async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
    const box = await a.locator('.leaflet-container').boundingBox();
    if (!box) throw new Error('no map');
    const at = (fx: number, fy: number) =>
      [box.x + box.width * fx, box.y + box.height * fy] as const;

    const ghostB = b.locator('.leaflet-elements-fx-pane path');
    const ghostA = a.locator('.leaflet-elements-fx-pane path');
    await a.keyboard.press('a');
    await a.mouse.move(...at(0.2, 0.3));
    await a.mouse.down();
    await a.mouse.move(...at(0.45, 0.4), { steps: 8 });
    await a.mouse.up();
    // the ghost lives ~650 ms on B's map, then the real (canvas) arrow takes over
    await expect(ghostB.first()).toBeAttached({ timeout: 5000 });
    await expect(ghostB).toHaveCount(0, { timeout: 5000 });
    await expect(ghostA).toHaveCount(0); // the drawer never sees their own entrance
    await expect.poll(() => debugCount(b)).toBe(1);

    await a.keyboard.press('m'); // default marker kind: enemy squad
    await a.mouse.click(...at(0.6, 0.6));
    await expect(b.locator('.rl-marker-icon.rl-enter-alert')).toHaveCount(1);
    await expect(a.locator('.rl-marker-icon.rl-enter-alert')).toHaveCount(1); // markers: everyone
    await expect.poll(() => debugPending(a)).toBe(0);
    await expect(a.locator('.rl-sync-dot')).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});

test('reduced motion: no entrance classes, no ghosts', async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  const box = await a.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  await a.keyboard.press('m');
  await a.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => debugCount(b)).toBe(1);
  await expect(b.locator('.rl-marker-icon')).toHaveCount(1);
  await expect(b.locator('.rl-enter')).toHaveCount(0);
  await expect(b.locator('.leaflet-elements-fx-pane path')).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});
