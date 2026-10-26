import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import type {} from '../src/lib/debug/rlDebug';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tiles');

/**
 * Serves /tiles/** from the committed fixture set (zoom 0–2, solid colours) so E2E never needs
 * real tiles. Returns the list of tile paths that were requested but are missing.
 */
export async function serveFixtureTiles(page: Page): Promise<string[]> {
  const missing: string[] = [];
  await page.route('**/tiles/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const rel = decodeURIComponent(pathname.replace(/^.*?\/tiles\//, ''));
    const file = path.join(FIXTURES, rel);
    if (!file.startsWith(FIXTURES) || !existsSync(file)) {
      missing.push(pathname);
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      body: readFileSync(file),
      contentType: file.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    });
  });
  return missing;
}

export const PASSWORD = 'correct horse battery staple';

/**
 * Registers a fresh user through the UI and lands on the dashboard. The first-visit room tour
 * is marked done (it would sit over the toolbar in every other test) unless `tour: true`.
 */
export async function registerViaUi(page: Page, username: string, opts: { tour?: boolean } = {}) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/dashboard$/);
  if (opts.tour) return;
  await pageApi(page, 'PATCH', '/me/prefs', { roomTourDone: true });
  await page.reload(); // the cached `me` predates the patch
  await page.waitForURL(/\/dashboard$/);
}

/** ≤ 20 chars, unique per run and per caller. */
export function uniqueName(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`.slice(
    0,
    20,
  );
}

/** JSON call to our API from inside the page (its cookies, our CSRF header). */
export async function pageApi<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'include',
        headers: {
          'x-requested-with': 'rotationlab',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
      return (res.status === 204 ? undefined : await res.json()) as unknown;
    },
    { method, path, body },
  ) as Promise<T>;
}

/**
 * Owner + second user in one room, both with the room open. `a` / `b` are context options
 * (a phone or tablet device descriptor, …); default: the project's desktop.
 */
export async function twoUsersInRoom(
  browser: Browser,
  opts: { a?: BrowserContextOptions; b?: BrowserContextOptions } = {},
) {
  const ctxA = await browser.newContext(opts.a);
  const ctxB = await browser.newContext(opts.b);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await serveFixtureTiles(a);
  await serveFixtureTiles(b);
  const nameA = uniqueName('rta');
  const nameB = uniqueName('rtb');
  await registerViaUi(a, nameA);
  await registerViaUi(b, nameB);
  const { room, board } = await pageApi<{ room: { id: string }; board: { id: string } }>(
    a,
    'POST',
    '/rooms',
    {
      name: `Realtime ${Date.now().toString(36)}`,
      firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
    },
  );
  const { invite } = await pageApi<{ invite: { code: string } }>(
    a,
    'POST',
    `/rooms/${room.id}/invites`,
    { expiresIn: '1h' },
  );
  await pageApi(b, 'POST', `/invites/${invite.code}/accept`, {});
  for (const p of [a, b]) {
    await p.goto(`/rooms/${room.id}`);
    await p.waitForFunction(() => window.__rlDebug?.ready() === true);
    await p.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  }
  return { ctxA, ctxB, a, b, nameA, nameB, roomId: room.id, boardId: board.id };
}

export const debugCount = (p: Page) => p.evaluate(() => window.__rlDebug?.count() ?? -1);
export const debugPending = (p: Page) => p.evaluate(() => window.__rlDebug?.pending() ?? -1);

/** Supervisor control (apps/server/scripts/e2e-api.ts). */
export async function controlApi(action: 'stop' | 'start' | 'restart') {
  const res = await fetch(`http://127.0.0.1:4299/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`api ${action}: ${res.status} ${await res.text()}`);
}
