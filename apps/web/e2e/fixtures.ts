import { deflateSync } from 'node:zlib';
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
    await foldLeftPanel(p);
  }
  return { ctxA, ctxB, a, b, nameA, nameB, roomId: room.id, boardId: board.id };
}

/**
 * Desktop glass layout: the left panel (route options + layers) opens by default and covers
 * the map's left third. Most specs click around the map, so rooms start with it folded; specs
 * about routes / layers call `openLeftPanel`.
 */
export async function foldLeftPanel(p: Page) {
  const fold = p.getByTestId('left-panel-collapse');
  if (await fold.isVisible()) await fold.click();
}

export async function openLeftPanel(p: Page) {
  const open = p.getByTestId('left-panel-open');
  if (await open.isVisible()) await open.click();
  await p.getByRole('complementary', { name: 'Plan panel' }).waitFor();
}

export const debugCount = (p: Page) => p.evaluate(() => window.__rlDebug?.count() ?? -1);
export const debugPending = (p: Page) => p.evaluate(() => window.__rlDebug?.pending() ?? -1);

/** Supervisor control (apps/server/scripts/e2e-api.ts). */
export async function controlApi(action: 'stop' | 'start' | 'restart') {
  const res = await fetch(`http://127.0.0.1:4299/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`api ${action}: ${res.status} ${await res.text()}`);
}

/** a minimal RGB PNG: left half orange, right half teal (no image library in the web app) */
export function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const p = o + 1 + x * 3;
      const [r, g, b] = x < width / 2 ? [240, 140, 40] : [30, 160, 160];
      rows[p] = r;
      rows[p + 1] = g;
      rows[p + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
