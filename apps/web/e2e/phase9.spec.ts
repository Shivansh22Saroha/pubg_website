import AxeBuilder from '@axe-core/playwright';
import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
} from '@playwright/test';
import {
  debugCount,
  debugPending,
  pageApi,
  PASSWORD,
  registerViaUi,
  serveFixtureTiles,
  twoUsersInRoom,
  uniqueName,
} from './fixtures';

/**
 * Phase 9: E2E-12 (phone), tablet touch drawing, E2E-13 (axe), keyboard-only, explore, the
 * room tour and 360 px layouts.
 */

/** device descriptors run in this project's Chromium (they default to WebKit) */
const device = (name: 'iPhone 13' | 'iPad (gen 7)'): BrowserContextOptions => {
  const { defaultBrowserType: _webkit, ...rest } = devices[name];
  return rest;
};
const PHONE = device('iPhone 13');
const TABLET = device('iPad (gen 7)');

async function mapPoint(p: Page, fx: number, fy: number): Promise<[number, number]> {
  const b = await p.locator('.leaflet-container').boundingBox();
  if (!b) throw new Error('no map');
  return [Math.round(b.x + b.width * fx), Math.round(b.y + b.height * fy)];
}

const noHorizontalScroll = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** a one-finger drag through CDP (Playwright's touchscreen only taps) */
async function touchDrag(cdp: CDPSession, from: [number, number], to: [number, number]) {
  const steps = 8;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from[0], y: from[1] }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('E2E-12: phone — every tool (six + More), chat sheet both ways, touch drawing and a tapped marker sync', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameB } = await twoUsersInRoom(browser, { a: PHONE });
  await expect(a.locator('[data-layout="phone"]')).toBeVisible();
  expect(await noHorizontalScroll(a)).toBe(true);

  // six tools + More in a bottom bar (2026-11: phones draw too), undo / redo in the top bar,
  // board dropdown, collapsed top bar
  const bar = a.getByTestId('toolbar');
  await expect(bar).toHaveAttribute('data-orientation', 'horizontal');
  const tools = await bar
    .locator('[data-testid^="tool-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(tools).toEqual([
    'tool-select',
    'tool-pen',
    'tool-arrow',
    'tool-circle',
    'tool-marker',
    'tool-eraser',
  ]);
  await expect(bar.getByTestId('tools-more')).toBeVisible();
  await expect(a.getByTestId('undo')).toBeVisible();
  await a.getByTestId('tools-more').tap();
  const more = a.getByTestId('tools-more-menu');
  for (const id of ['line', 'polygon', 'text', 'measure', 'laser'])
    await expect(more.getByTestId(`tool-${id}`)).toBeVisible();
  await more.getByTestId('tool-line').tap();
  await expect(a.getByTestId('tools-more')).toHaveAttribute('aria-label', 'More tools — Line');
  await a.getByTestId('tool-select').tap();
  await expect(a.getByTestId('board-select')).toBeVisible();
  await expect(a.getByRole('tablist', { name: 'Boards' })).toHaveCount(0);
  await a.getByTestId('room-menu').tap();
  for (const item of ['Invite teammates', 'Members', 'Room settings'])
    await expect(a.getByRole('menuitem', { name: item })).toBeVisible();
  await a.keyboard.press('Escape');
  // every tool button is a ≥ 44 px touch target
  const small = await bar.locator('button').evaluateAll(
    (els) =>
      els.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      }).length,
  );
  expect(small).toBe(0);

  // chat: a full-screen sheet; send and receive
  await a.getByTestId('chat-fab').tap();
  const sheet = a.getByTestId('panel-sheet');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box?.height).toBeGreaterThan(600); // full screen
  await sheet.getByRole('textbox', { name: 'Message' }).fill('rotating north');
  await sheet.getByRole('button', { name: 'Send' }).tap();
  // (the sr-only live region repeats the text — look in the message list)
  await expect(b.getByTestId('chat-body').filter({ hasText: 'rotating north' })).toBeVisible();
  await b.getByRole('textbox', { name: 'Message' }).fill('copy that');
  await b.keyboard.press('Enter');
  await expect(sheet.getByText('copy that')).toBeVisible();
  await expect(sheet.getByText(nameB).first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Close panel' }).tap();
  await expect(sheet).toHaveCount(0);

  // one finger draws an arrow; the desktop user sees it; undo from the top bar removes it
  await a.getByTestId('tool-arrow').tap();
  const cdpDraw = await ctxA.newCDPSession(a);
  await touchDrag(cdpDraw, await mapPoint(a, 0.3, 0.55), await mapPoint(a, 0.65, 0.35));
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(1);
  await a.getByTestId('undo').tap();
  await expect.poll(() => debugCount(b)).toBe(0);

  // one finger places a marker; the desktop user sees it
  await a.getByTestId('tool-marker').tap();
  await a.getByTestId('marker-kind-enemy_squad').tap();
  await expect(a.getByTestId('tool-marker')).toHaveAttribute('aria-pressed', 'true');
  await a.touchscreen.tap(...(await mapPoint(a, 0.5, 0.45)));
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(1);
  await expect(b.locator('.rl-marker')).toHaveCount(1);

  // long press on it (Select): the context menu deletes it
  await a.getByTestId('tool-select').tap();
  const cdp = await ctxA.newCDPSession(a);
  const [x, y] = await mapPoint(a, 0.5, 0.45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await a.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const menu = a.getByTestId('long-press-menu');
  await expect(menu.getByRole('menuitem', { name: 'Edit label' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete' }).tap();
  await expect.poll(() => debugCount(b)).toBe(0);

  await ctxA.close();
  await ctxB.close();
});

test('phone held sideways: phone layout, tools in a left column that fits, touch drawing syncs', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser, {
    a: { ...PHONE, viewport: { width: 844, height: 390 } },
  });
  // 844 px wide would be "tablet" — but it's a touch screen under 520 px tall: a phone
  await expect(a.locator('[data-layout="phone"]')).toBeVisible();
  expect(await noHorizontalScroll(a)).toBe(true);
  const bar = a.getByTestId('toolbar');
  await expect(bar).toHaveAttribute('data-orientation', 'vertical');
  // the whole column is on screen: no tool hidden below the fold
  const fits = await bar.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(fits).toBe(true);
  const barBox = await bar.boundingBox();
  const mapBox = await a.locator('.leaflet-container').boundingBox();
  expect(barBox!.x).toBeLessThan(mapBox!.x); // left of the map
  expect(mapBox!.height).toBeGreaterThan(300); // the map keeps the height

  await a.getByTestId('tool-pen').tap();
  const cdp = await ctxA.newCDPSession(a);
  await touchDrag(cdp, await mapPoint(a, 0.35, 0.6), await mapPoint(a, 0.6, 0.4));
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(1);
  await ctxA.close();
  await ctxB.close();
});

test('tablet: bottom toolbar with every tool, half-height sheet, a touch-drawn arrow syncs', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser, { a: TABLET });
  await expect(a.locator('[data-layout="tablet"]')).toBeVisible();
  const bar = a.getByTestId('toolbar');
  await expect(bar).toHaveAttribute('data-orientation', 'horizontal');
  const barBox = await bar.boundingBox();
  const vh = a.viewportSize()?.height ?? 0;
  expect(barBox && barBox.y + barBox.height).toBeGreaterThanOrEqual(vh - 1); // at the bottom
  for (const t of ['pen', 'line', 'arrow', 'circle', 'marker', 'eraser', 'select'])
    await expect(a.getByTestId(`tool-${t}`)).toBeVisible();
  expect(await noHorizontalScroll(a)).toBe(true);

  // the panel is a half-height sheet from the chat button
  await a.getByTestId('chat-fab').tap();
  const sheet = a.getByTestId('panel-sheet');
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox!.height).toBeGreaterThan(vh * 0.4);
  expect(sheetBox!.height).toBeLessThan(vh * 0.6);
  await sheet.getByRole('button', { name: 'Close panel' }).tap();

  // arrow: press-drag-release with one finger
  await a.getByTestId('tool-arrow').tap();
  // the style bar sits above the bottom toolbar
  const style = await a.getByTestId('style-bar').boundingBox();
  expect(style && style.y + style.height).toBeLessThanOrEqual(barBox!.y);
  const cdp = await ctxA.newCDPSession(a);
  await touchDrag(cdp, await mapPoint(a, 0.3, 0.4), await mapPoint(a, 0.6, 0.55));
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect
    .poll(() => b.evaluate(() => (window.__rlDebug?.elements() ?? []).map((e) => e.type).join(',')))
    .toBe('ARROW');

  await ctxA.close();
  await ctxB.close();
});

test.describe('E2E-13: axe — 0 serious / critical violations', () => {
  test.describe.configure({ timeout: 120_000 }); // many pages, one scan each
  const scan = async (p: Page, what: string) => {
    const result = await new AxeBuilder({ page: p })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // the map canvas itself is out of scope (UI_UX_SPEC §10: non-map UI)
      .exclude('.leaflet-container')
      .analyze();
    const bad = result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map(
        (v) =>
          `${what}: ${v.id} (${v.impact}) — ${v.nodes.map((n) => n.html.slice(0, 160)).join(' | ')}`,
      );
    expect(bad, bad.join('\n')).toEqual([]);
  };

  test('public pages: landing, login, register, explore, join, privacy', async ({
    page,
    browser,
  }) => {
    await serveFixtureTiles(page);
    for (const url of ['/', '/login', '/register', '/privacy', '/terms']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await scan(page, url);
    }
    await page.goto('/explore');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await scan(page, '/explore');

    // join: a real invite, seen logged out
    const { ctxA, ctxB, a } = await twoUsersInRoom(browser);
    const rooms = await pageApi<{ items: { id: string }[] }>(a, 'GET', '/rooms');
    const { invite } = await pageApi<{ invite: { code: string } }>(
      a,
      'POST',
      `/rooms/${rooms.items[0]!.id}/invites`,
      { expiresIn: '1h' },
    );
    await page.goto(`/join/${invite.code}`);
    await expect(page.getByText(/Realtime/)).toBeVisible();
    await scan(page, '/join');
    await ctxA.close();
    await ctxB.close();
  });

  test('logged in: dashboard, settings, room (non-map regions, panel tabs, dialogs)', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a } = await twoUsersInRoom(browser);
    await scan(a, 'room');
    for (const tab of ['Layers', 'Members']) {
      await a.getByRole('tab', { name: tab }).click();
      await scan(a, `room · ${tab}`);
    }
    await a.getByRole('tab', { name: 'Layers' }).click();
    await a.getByTestId('layers-view-list').click();
    await scan(a, 'room · element list');
    await a.getByRole('button', { name: 'Invite' }).click();
    await expect(a.getByRole('dialog')).toBeVisible();
    await scan(a, 'room · invite dialog');
    await a.keyboard.press('Escape');
    await a.goto('/dashboard');
    await a.waitForLoadState('networkidle');
    await scan(a, '/dashboard');
    await a.goto('/settings');
    await expect(a.getByLabel('In-game name (IGN)')).toBeVisible();
    await scan(a, '/settings');
    await ctxA.close();
    await ctxB.close();
  });
});

/** Tab until the focused element's accessible name matches (no mouse anywhere). */
async function tabTo(p: Page, name: RegExp, max = 40) {
  for (let i = 0; i < max; i++) {
    await p.keyboard.press('Tab');
    const focused = await p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      const label =
        el.getAttribute('aria-label') ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.textContent;
      return label.trim();
    });
    if (name.test(focused)) return;
  }
  throw new Error(`never reached ${String(name)} by Tab`);
}

test('keyboard only: register → create a room → open invite → send a chat message', async ({
  page,
}) => {
  await serveFixtureTiles(page);
  const name = uniqueName('kbd');
  await page.goto('/register');
  await tabTo(page, /^Email$/);
  await page.keyboard.type(`${name}@example.com`);
  await tabTo(page, /^Username$/);
  await page.keyboard.type(name);
  await tabTo(page, /^Password$/);
  await page.keyboard.type(PASSWORD);
  await tabTo(page, /^Confirm password$/);
  await page.keyboard.type(PASSWORD);
  await tabTo(page, /^Create account$/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/dashboard$/);

  await tabTo(page, /New room/);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await tabTo(page, /^Name/);
  await page.keyboard.type('Keyboard squad');
  await tabTo(page, /^Create room$/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/rooms\//);
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');

  // the first-visit tour takes focus; Esc dismisses it
  await expect(page.getByTestId('room-tour')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('room-tour')).toHaveCount(0);

  await tabTo(page, /^Invite$/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /Invite/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Invite/ })).toHaveCount(0);

  await page.keyboard.press('/'); // UI_UX_SPEC §8: focus the chat
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await page.keyboard.type('gg from the keyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('gg from the keyboard');
});

test('explore: no login, map switching, measure, and no socket ever opened', async ({ page }) => {
  await serveFixtureTiles(page);
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('request', (r) => {
    if (r.url().includes('/realtime')) sockets.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore maps' }).click();
  await page.waitForURL(/\/explore$/);
  await expect(page.getByText('Create a free account to save your own boards')).toBeVisible();
  // the seeded demo board is drawn, read-only
  await expect(page.locator('.rl-marker').first()).toBeVisible();
  await expect(page.getByTestId('toolbar')).toHaveCount(0);

  await page.getByTestId('explore-map-miramar').click();
  await expect(page.getByTestId('explore-map-miramar')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map', 'miramar');
  await page.getByTestId('explore-map-rondo').click();
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-map', 'rondo');

  await page.keyboard.press('r');
  await expect(page.getByTestId('explore-measure')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(...(await mapPoint(page, 0.3, 0.3)));
  await page.mouse.dblclick(...(await mapPoint(page, 0.6, 0.6)));
  await expect(page.locator('.rl-measure-total')).toContainText(
    / m · ~\d+ min on foot · ~\d+ min by vehicle \(approx\.\)/,
  );
  await page.waitForTimeout(500);
  expect(sockets).toEqual([]);
});

test('the room tour shows once — not after a reload, not in another context for the same user', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await serveFixtureTiles(p);
  const name = uniqueName('tour');
  await registerViaUi(p, name, { tour: true });
  const { room } = await pageApi<{ room: { id: string } }>(p, 'POST', '/rooms', {
    name: 'Tour room',
    firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
  });
  await p.goto(`/rooms/${room.id}`);
  const tour = p.getByTestId('room-tour');
  await expect(tour).toContainText('Step 1 of 3');
  await expect(tour).toContainText('Your tools');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Boards');
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Invite your squad');
  await tour.getByRole('button', { name: 'Done' }).click();
  await expect(tour).toHaveCount(0);
  await expect
    .poll(() => pageApi<{ user: { prefs: { roomTourDone: boolean } } }>(p, 'GET', '/me'))
    .toMatchObject({ user: { prefs: { roomTourDone: true } } });

  await p.reload();
  await p.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  await p.waitForTimeout(500);
  await expect(tour).toHaveCount(0);

  const other = await browser.newContext();
  const q = await other.newPage();
  await serveFixtureTiles(q);
  await q.goto('/login');
  await q.getByLabel('Email or username').fill(name);
  await q.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await q.getByRole('button', { name: 'Log in' }).click();
  await q.waitForURL(/\/dashboard$/);
  await q.goto(`/rooms/${room.id}`);
  await q.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  await q.waitForTimeout(500);
  await expect(q.getByTestId('room-tour')).toHaveCount(0);
  await ctx.close();
  await other.close();
});

test('360 px: landing, auth, dashboard, settings, join and explore never scroll sideways', async ({
  browser,
}) => {
  // visits ten pages, each waiting for network idle: close to the default 30 s on slow runners
  test.slow();
  const { ctxA, ctxB, a } = await twoUsersInRoom(browser, {
    a: { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true },
  });
  const rooms = await pageApi<{ items: { id: string }[] }>(a, 'GET', '/rooms');
  const { invite } = await pageApi<{ invite: { code: string } }>(
    a,
    'POST',
    `/rooms/${rooms.items[0]!.id}/invites`,
    { expiresIn: '1h' },
  );
  for (const url of ['/dashboard', '/settings', `/join/${invite.code}`, '/explore', '/']) {
    await a.goto(url);
    await a.waitForLoadState('networkidle');
    expect(await noHorizontalScroll(a), url).toBe(true);
  }
  const anon = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const p = await anon.newPage();
  for (const url of ['/login', '/register', '/forgot-password', '/privacy', '/terms']) {
    await p.goto(url);
    await p.waitForLoadState('networkidle');
    expect(await noHorizontalScroll(p), url).toBe(true);
  }
  await anon.close();
  await ctxA.close();
  await ctxB.close();
});

test('landing: logged-in users see "Go to dashboard"; footer credits; security.txt', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan your rotations together.');
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('KRAFTON');
  await expect(page.getByRole('contentinfo')).toContainText('PC map art — BGMI');
  // no map code on the landing page
  const leaflet = await page.evaluate(() =>
    performance.getEntriesByType('resource').some((r) => /leaflet/i.test(r.name)),
  );
  expect(leaflet).toBe(false);

  await registerViaUi(page, uniqueName('land'));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create a room' })).toHaveAttribute(
    'href',
    '/dashboard',
  );

  const txt = await request.get('/.well-known/security.txt');
  expect(txt.status()).toBe(200);
  expect(await txt.text()).toMatch(/^Contact: mailto:security@example\.com$/m);
});
