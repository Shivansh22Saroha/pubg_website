import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { debugCount, debugPending, PASSWORD, serveFixtureTiles, twoUsersInRoom } from './fixtures';

/** Phase 8: snapshots (E2E-7), PNG export (E2E-11), measure, settings, account deletion. */

type XY = [number, number];

async function at(p: Page, fx: number, fy: number): Promise<XY> {
  const b = await p.locator('.leaflet-container').boundingBox();
  if (!b) throw new Error('no map');
  return [b.x + b.width * fx, b.y + b.height * fy];
}

async function placeMarker(p: Page, xy: XY) {
  await p.keyboard.press('m');
  await p.mouse.click(...xy);
}

const elementsOf = (p: Page) =>
  p.evaluate(() =>
    (window.__rlDebug?.elements() ?? []).map((e) => `${e.id}|${JSON.stringify(e.geometry)}`).sort(),
  );

async function openSnapshots(p: Page) {
  await p.getByTestId('more-menu').click();
  await p.getByRole('menuitem', { name: 'Snapshots…' }).click();
  await expect(p.getByTestId('snapshots-drawer')).toBeVisible();
}

test('E2E-7: save → modify → restore; both contexts equal the snapshot and undo stacks are cleared', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameA } = await twoUsersInRoom(browser);
  for (const fx of [0.3, 0.4, 0.5]) await placeMarker(a, await at(a, fx, 0.4));
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(3);
  const saved = await elementsOf(a);

  await openSnapshots(a);
  await a.getByRole('textbox', { name: 'Snapshot name' }).fill('Plan A – north zone');
  await a.getByRole('button', { name: 'Save snapshot' }).click();
  await expect(
    a.getByTestId('snapshot-item').filter({ hasText: 'Plan A – north zone' }),
  ).toBeVisible();
  await a.keyboard.press('Escape');
  await expect(a.getByTestId('snapshots-drawer')).toHaveCount(0);

  // modify on both sides (each leaves an undo step)
  await placeMarker(a, await at(a, 0.6, 0.6));
  await placeMarker(b, await at(b, 0.65, 0.5));
  await expect.poll(() => debugCount(a)).toBe(5);
  await expect(a.getByTestId('undo')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(b.getByTestId('undo')).not.toHaveAttribute('aria-disabled', 'true');

  // preview, then restore with a confirm
  await openSnapshots(a);
  await a.getByTestId('snapshot-item').filter({ hasText: 'Plan A – north zone' }).click();
  await expect(a.getByTestId('snapshot-preview')).toBeVisible();
  await expect(a.getByTestId('snapshot-preview').locator('.rl-marker')).toHaveCount(3);
  await a.getByRole('button', { name: 'Restore' }).click();
  await expect(a.getByRole('alertdialog', { name: 'Confirm restore' })).toContainText(
    'auto-saved first',
  );
  await a.getByTestId('confirm-snapshot-restore').click();

  await expect.poll(() => elementsOf(a)).toEqual(saved);
  await expect.poll(() => elementsOf(b)).toEqual(saved);
  await expect(b.getByText(`Board was restored by ${nameA}`)).toBeVisible();
  await expect(a.getByTestId('undo')).toHaveAttribute('aria-disabled', 'true');
  await expect(b.getByTestId('undo')).toHaveAttribute('aria-disabled', 'true');
  await expect(
    b
      .getByTestId('chat-system')
      .filter({ hasText: `${nameA} restored snapshot 'Plan A – north zone'` }),
  ).toBeVisible();

  // the state it replaced was kept as an auto snapshot
  await openSnapshots(b);
  await expect(
    b.getByTestId('snapshot-item').filter({ hasText: "Before restore of 'Plan A – north zone'" }),
  ).toContainText('auto');

  await ctxA.close();
  await ctxB.close();
});

test('E2E-11: Export PNG downloads a non-empty image of viewport × DPR with the footer', async ({
  browser,
}) => {
  const { ctxA, ctxB, a } = await twoUsersInRoom(browser);
  await placeMarker(a, await at(a, 0.4, 0.4));
  await expect.poll(() => debugPending(a)).toBe(0);
  const size = await a.locator('.leaflet-container').evaluate((el) => ({
    w: el.clientWidth,
    h: el.clientHeight,
    dpr: Math.min(2, window.devicePixelRatio || 1),
  }));

  await a.getByTestId('more-menu').click();
  const [download] = await Promise.all([
    a.waitForEvent('download'),
    a.getByRole('menuitem', { name: 'Export PNG' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^realtime-[a-z0-9]+_erangel-plan-1_\d{4}-\d{2}-\d{2}\.png$/,
  );
  const bytes = readFileSync(await download.path());
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  // IHDR: width / height, big-endian, right after the signature and chunk header
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    Math.round(size.w * size.dpr),
    Math.round(size.h * size.dpr),
  ]);
  // the footer strip: solid #0B0F14 at the bottom-left corner
  const pixel = await a.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    return Array.from(ctx.getImageData(2, bmp.height - 2, 1, 1).data.slice(0, 3));
  }, bytes.toString('base64'));
  expect(pixel).toEqual([11, 15, 20]);

  await ctxA.close();
  await ctxB.close();
});

test('measure across the map shows distance and approx. travel time (local only)', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await a.keyboard.press('r');
  await expect(a.getByTestId('tool-measure')).toHaveAttribute('aria-pressed', 'true');
  await a.mouse.click(...(await at(a, 0.3, 0.3)));
  await a.mouse.click(...(await at(a, 0.6, 0.3)));
  await a.mouse.dblclick(...(await at(a, 0.6, 0.6)));
  const total = a.locator('.rl-measure-total');
  await expect(total).toContainText(/ m · ~\d+ min on foot · ~\d+ min by vehicle \(approx\.\)/);
  await expect(a.locator('.rl-measure-segment')).toHaveCount(2);
  expect(await debugCount(a)).toBe(0); // nothing created
  await expect(b.locator('.rl-measure-total')).toHaveCount(0); // never sent
  await a.keyboard.press('Escape');
  await expect(total).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

async function loginViaUi(p: Page, identifier: string) {
  await p.goto('/login');
  await p.getByLabel('Email or username').fill(identifier);
  await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: 'Log in' }).click();
  await p.waitForURL(/\/dashboard$/);
}

test('settings: change IGN; changing the password logs out the other context', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, nameA } = await twoUsersInRoom(browser);
  const ctxA2 = await browser.newContext();
  const a2 = await ctxA2.newPage();
  await serveFixtureTiles(a2);
  await loginViaUi(a2, nameA);

  await a.goto('/settings');
  await a.getByLabel('In-game name (IGN)').fill('Shiva');
  await a.getByRole('button', { name: 'Save profile' }).click();
  await expect(a.getByText('Profile saved')).toBeVisible();
  await a.reload();
  await expect(a.getByLabel('In-game name (IGN)')).toHaveValue('Shiva');
  await expect(a.getByTestId('sessions').getByText('This device')).toBeVisible();

  await a.getByLabel('Current password').fill(PASSWORD);
  await a.getByLabel('New password').fill('an entirely new passphrase');
  await a.getByRole('button', { name: 'Change password' }).click();
  await expect(a.getByText('Password changed')).toBeVisible();
  // this device stays in; the other one is out
  await a.goto('/dashboard');
  await expect(a.getByTestId('dashboard-greeting')).toBeVisible();
  await a2.goto('/dashboard');
  await expect(a2).toHaveURL(/\/login/);

  await ctxA.close();
  await ctxA2.close();
  await ctxB.close();
});

test('delete account: the owned room goes to the other user, who then sees themselves as owner', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameB, roomId } = await twoUsersInRoom(browser);
  await a.goto('/settings');
  await a.getByRole('button', { name: 'Delete account' }).click();
  const dialog = a.getByRole('dialog', { name: 'Delete your account' });
  await expect(dialog.getByTestId('owned-rooms')).toBeVisible();
  await dialog.getByRole('combobox').selectOption({ label: `Transfer to ${nameB} (Editor)` });
  await dialog.getByLabel('Password').fill(PASSWORD);
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account' }).click();
  await expect(a).toHaveURL(/\/$/);

  // B (still in the room) becomes the owner live
  await expect(b.getByRole('button', { name: 'Room settings' })).toBeVisible();
  await b.getByRole('tab', { name: 'Members' }).click();
  await expect(b.getByTestId('member-row')).toHaveCount(1);
  await expect(b.getByTestId('member-row').filter({ hasText: nameB })).toContainText('Owner');
  await b.goto('/dashboard');
  await expect(b.locator(`a[href="/rooms/${roomId}"]`)).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
