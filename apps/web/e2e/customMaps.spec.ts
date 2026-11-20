import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { makePng, twoUsersInRoom } from './fixtures';

/**
 * Custom maps (FEATURES F20): upload an image through the New board dialog, plan on it, and a
 * teammate sees the same map. Distances use the width the uploader entered.
 */

const mapImageLoaded = (p: Page) =>
  p.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('img.custom-map-image');
    return Boolean(img?.complete && img.naturalWidth > 0);
  });

test('E2E-C1: upload a custom map, plan on it, measure in its metres; a teammate sees it', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);

  // A: New board → Upload map
  await a.getByRole('button', { name: 'New board' }).click();
  await a.getByTestId('custom-map-upload-open').click();
  await a.getByTestId('custom-map-file').setInputFiles({
    name: 'bermuda_island.png',
    mimeType: 'image/png',
    buffer: makePng(600, 400),
  });
  // the name comes from the file; the width is the uploader's call
  await expect(a.getByLabel('Map name')).toHaveValue('bermuda island');
  await a.getByLabel('Map name').fill('Bermuda');
  await a.getByLabel('Width (m)').fill('2040');
  await a.getByTestId('custom-map-upload-submit').click();
  // the new map is picked, and the board name follows it
  await expect(a.getByTestId('custom-map-option')).toHaveCount(1);
  await expect(a.getByTestId('custom-map-option').locator('input')).toBeChecked();
  await expect(a.getByLabel('Name', { exact: true })).toHaveValue('Bermuda – Plan 1');
  await a.getByRole('button', { name: 'Create board' }).click();

  // the board shows the uploaded image, with no PUBG-only controls
  const canvas = a.getByTestId('map-canvas');
  await expect(canvas).toHaveAttribute('data-map', 'custom');
  await expect.poll(() => mapImageLoaded(a), { timeout: 15_000 }).toBe(true);
  await expect(a.getByRole('button', { name: 'Map labels' })).toHaveCount(0);
  await expect(a.getByTestId('vehicles-toggle')).toHaveCount(0);

  // the cursor readout is in this map's metres: nowhere on it is beyond 2 040 m
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no map');
  // right of centre but clear of the floating side panel (F22)
  await a.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  const readout = await a.getByTestId('hud-readout').innerText();
  const metres = [...readout.matchAll(/([\d\s\u00a0\u202f]+) m/g)].map((m) =>
    Number((m[1] ?? '').replace(/\D/g, '')),
  );
  expect(metres.length).toBe(2);
  for (const m of metres) expect(m).toBeLessThanOrEqual(2040);
  expect(metres[0]).toBeGreaterThan(600); // well across a 2 km map, not centimetres

  // B sees the new board and the same image
  await b.getByRole('tab', { name: /Bermuda – Plan 1/ }).click();
  await expect(b.getByTestId('map-canvas')).toHaveAttribute('data-map', 'custom');
  await expect.poll(() => mapImageLoaded(b), { timeout: 15_000 }).toBe(true);

  // the width can be fixed later: the readout follows
  await a.getByRole('button', { name: /Board actions for Bermuda/ }).click();
  await a.getByRole('menuitem', { name: /Map name & size/ }).click();
  await a.getByLabel(/Width in metres/).fill('4080');
  await a.getByRole('button', { name: 'Save' }).click();
  await a.mouse.move(box.x + box.width * 0.75 + 1, box.y + box.height * 0.5);
  await expect
    .poll(async () => {
      const t = await a.getByTestId('hud-readout').innerText();
      return Number((/([\d\s\u00a0\u202f]+) m/.exec(t)?.[1] ?? '').replace(/\D/g, ''));
    })
    .toBeGreaterThan(2040);

  // the whole-map export uses the full uploaded image: orange on the left, teal on the right
  await a.getByTestId('more-menu').click();
  const [download] = await Promise.all([
    a.waitForEvent('download'),
    a.getByRole('menuitem', { name: 'Export whole map as PNG' }).click(),
  ]);
  const bytes = readFileSync(await download.path());
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([4096, 4096]);
  const px = await a.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    return { left: at(1300, 2300), right: at(2800, 2300) }; // inside squares, off the grid lines
  }, bytes.toString('base64'));
  const near = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - (q[i] ?? 0)) < 24);
  expect(near(px.left, [240, 140, 40])).toBe(true);
  expect(near(px.right, [30, 160, 160])).toBe(true);

  await ctxA.close();
  await ctxB.close();
});
