import { AUTH_COOKIES } from '@rotationlab/shared';
import { expect, test, type Page } from '@playwright/test';
import { pageApi, registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * Server-rendered dashboard (ARCHITECTURE §4 "Server prefetch"): the room cards are in the
 * first HTML response, hydrate without errors, and a bad access cookie falls back to the
 * client fetch + silent refresh.
 */
async function withRoom(page: Page) {
  await serveFixtureTiles(page);
  await registerViaUi(page, uniqueName('dash'));
  const name = `SSR ${Date.now().toString(36)}`;
  await pageApi(page, 'POST', '/rooms', {
    name,
    firstBoard: { name: 'Rondo – Plan 1', mapId: 'rondo' },
  });
  return name;
}

test('room cards come in the HTML and hydrate without console errors', async ({ page }) => {
  const name = await withRoom(page);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  const res = await page.goto('/dashboard');
  const html = (await res?.text()) ?? '';
  expect(html).toContain(name);
  // React hoists the priority image into a <head> preload: it loads before any JS runs
  expect(html).toMatch(/<link rel="preload" as="image" href="\/tiles\/rondo\/card\.webp"/);

  await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

test('an invalid access cookie still ends on the dashboard via the client refresh', async ({
  page,
}) => {
  const name = await withRoom(page);
  const access = (await page.context().cookies()).find(
    (c) => c.name === AUTH_COOKIES.access || c.name === AUTH_COOKIES.accessSecure,
  );
  if (!access) throw new Error('no access cookie');
  await page.context().addCookies([{ ...access, value: 'not-a-jwt' }]);

  const res = await page.goto('/dashboard');
  expect((await res?.text()) ?? '').not.toContain(name); // nothing prefetched
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});
