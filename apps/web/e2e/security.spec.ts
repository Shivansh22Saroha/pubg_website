import { expect, test, type Page } from '@playwright/test';
import { pageApi, registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * Phase 10 (SECURITY §5 T4, TESTING §5.3 / §5.6): every page is served with a nonce CSP, every
 * script carries the nonce, and walking the whole app raises no CSP violation.
 */
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

test('pages carry a nonce CSP and the scripts use it', async ({ page }) => {
  const res = await page.goto('/');
  const csp = res?.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce, csp).toBeTruthy();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");

  const scripts = await page
    .locator('script')
    .evaluateAll((els) =>
      els.map((s) => ({ nonce: (s as HTMLScriptElement).nonce, src: s.getAttribute('src') })),
    );
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s.nonce, s.src ?? 'inline').toBe(nonce);

  // fresh per request
  const again = await page.request.get('/');
  expect(again.headers()['content-security-policy']).not.toBe(csp);
});

test('walking the app raises no CSP violation', async ({ page }) => {
  await serveFixtureTiles(page);
  const violations = await watchCsp(page);

  for (const path of ['/', '/login', '/register', '/explore', '/privacy', '/terms']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await registerViaUi(page, uniqueName('csp'));
  const { room } = await pageApi<{ room: { id: string } }>(page, 'POST', '/rooms', {
    name: `CSP ${Date.now().toString(36)}`,
    firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
  });
  await page.goto(`/rooms/${room.id}`);
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');

  expect(await violations()).toEqual([]);
});
