/**
 * Landing-page feature screenshots (UI_UX_SPEC §3.1): three static WebP images of the seeded
 * demo boards, written to public/landing/. Run against `pnpm dev` with real tiles, the dev
 * seed and DEMO_BOARD_IDS set (`pnpm --filter server seed`):
 *
 *   pnpm --filter web shots            # BASE_URL defaults to http://localhost:3000
 *
 * WebP is encoded by Chromium itself (OffscreenCanvas.convertToBlob), so no image library is
 * needed. Re-run whenever the UI changes enough to make the pictures stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const USER = process.env.SHOTS_USER ?? 'alice';
const PASSWORD = process.env.SEED_DEV_PASSWORD ?? 'devpassword123!';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'landing');
/** card images are shown at ≤ ~400 css px; 960×600 stays sharp on 2× screens */
const SIZE = { width: 960, height: 600 };

async function toWebp(page: Page, png: Buffer, file: string) {
  const b64 = await page.evaluate(
    async ({ data, width, height }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.78 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    },
    { data: png.toString('base64'), ...SIZE },
  );
  const out = Buffer.from(b64, 'base64');
  writeFileSync(path.join(OUT, file), out);
  console.log(`${file}: ${(out.length / 1024).toFixed(0)} KB`);
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // never the Next dev-tools badge in a marketing picture
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(800); // tiles fade in
}

async function zoomAt(page: Page, fx: number, fy: number, steps: number) {
  const box = await page.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(350);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();

  // 1. Live drawing — the Erangel demo board, zoomed onto the plan
  await page.goto(`${BASE}/explore`);
  await page.getByTestId('explore-map-erangel').click();
  await settle(page);
  await zoomAt(page, 0.52, 0.47, 2);
  await settle(page);
  await toWebp(page, await page.getByTestId('explore-map').screenshot(), 'live-drawing.webp');

  // 3. The maps — Miramar with the grid and a measured route
  await page.getByTestId('explore-map-miramar').click();
  await settle(page);
  await zoomAt(page, 0.5, 0.48, 1);
  await settle(page);
  await page.keyboard.press('r');
  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  if (!box) throw new Error('no map');
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await page.mouse.click(...at(0.38, 0.62));
  await page.mouse.click(...at(0.5, 0.5));
  await page.mouse.dblclick(...at(0.6, 0.36));
  await page.mouse.move(...at(0.1, 0.9));
  await settle(page);
  await toWebp(page, await page.getByTestId('explore-map').screenshot(), 'maps.webp');

  // 2. Map pings in chat — the dev seed's "Demo Squad" room, a pinged message
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email or username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/dashboard$/);
  // same-origin fetch from the page (CSRF: Origin + header), like the E2E fixtures
  await page.evaluate(async () => {
    await fetch('/api/v1/me/prefs', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'x-requested-with': 'rotationlab', 'content-type': 'application/json' },
      body: JSON.stringify({ roomTourDone: true }),
    });
  });
  await page.reload(); // the cached `me` predates the patch
  await page
    .getByRole('link', { name: /Demo Squad/ })
    .first()
    .click();
  await page.waitForSelector('[data-testid="sync-indicator"][data-state="synced"]');
  await settle(page);
  await zoomAt(page, 0.5, 0.5, 1);
  const message = 'Enemies holding the ridge — rotate west';
  if ((await page.getByText(message).count()) === 0) {
    await page.getByTestId('ping-button').click();
    await page.mouse.click(...at(0.55, 0.42));
    await page.getByRole('textbox', { name: 'Message' }).fill(message);
    await page.getByRole('button', { name: 'Send' }).click();
  }
  await settle(page);
  await toWebp(page, await page.screenshot(), 'map-pings.webp');

  await browser.close();
}

await main();
