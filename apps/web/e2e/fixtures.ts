import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

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

/** Registers a fresh user through the UI and lands on the dashboard. */
export async function registerViaUi(page: Page, username: string) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/dashboard$/);
}

/** ≤ 20 chars, unique per run and per caller. */
export function uniqueName(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`.slice(
    0,
    20,
  );
}
