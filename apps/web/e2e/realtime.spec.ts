import { expect, test, type Page } from '@playwright/test';
import { controlApi, debugCount, debugPending, pageApi, twoUsersInRoom } from './fixtures';

/**
 * Realtime client (Phase 5B; RT-1/2/3/6, FEATURES F8) with two browser contexts. Elements are
 * created through the dev/E2E debug hook (`window.__rlDebug`) until Phase 6 adds tools.
 */
test.describe.configure({ mode: 'serial' });

test('A adds 20 elements, B sees all within 1 s; B moves one, A sees the move; presence & cursors', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameA, nameB } = await twoUsersInRoom(browser);

  expect(await a.evaluate(() => window.__rlDebug!.addRandomElements(20))).toBe(20);
  const started = Date.now();
  await expect.poll(() => debugCount(b), { timeout: 1000, intervals: [25] }).toBe(20);
  test.info().annotations.push({
    type: 'sync-20',
    description: `${Date.now() - started} ms until B had all 20`,
  });
  await expect.poll(() => debugPending(a)).toBe(0);

  const id = await b.evaluate(() => window.__rlDebug!.moveElement());
  expect(id).not.toBeNull();
  const after = await b.evaluate((i) => window.__rlDebug!.geometry(i!), id);
  await expect.poll(() => a.evaluate((i) => window.__rlDebug!.geometry(i!), id)).toEqual(after);

  // presence: both avatars with rings, on both sides
  await expect(a.getByTestId('presence-avatar')).toHaveCount(2);
  await expect(b.getByTestId('presence-avatar')).toHaveCount(2);
  await expect(b.locator(`[data-testid="presence-avatar"][data-user="${nameA}"]`)).toBeVisible();
  await expect(a.getByTestId('board-presence').first()).toBeVisible();

  // cursors: A moves over the map, B sees a cursor labelled with A's name (and vice versa)
  const box = await a.locator('.leaflet-container').boundingBox();
  for (let i = 0; i < 10; i++) await a.mouse.move(box!.x + 200 + i * 10, box!.y + 200 + i * 5);
  await expect(b.locator('.rl-cursor-name', { hasText: nameA })).toBeVisible();
  const boxB = await b.locator('.leaflet-container').boundingBox();
  for (let i = 0; i < 10; i++) await b.mouse.move(boxB!.x + 300 + i * 10, boxB!.y + 250);
  await expect(a.locator('.rl-cursor-name', { hasText: nameB })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test('offline: 3 edits queue up, then reach B exactly once when back online', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, boardId } = await twoUsersInRoom(browser);
  await a.evaluate(() => window.__rlDebug!.addRandomElements(2));
  await expect.poll(() => debugCount(b)).toBe(2);

  await ctxA.setOffline(true);
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'offline');
  await a.evaluate(() => window.__rlDebug!.addRandomElements(3));
  await a.waitForTimeout(800);
  expect(await debugCount(a)).toBe(5); // shown locally right away (overlay)
  expect(await debugPending(a)).toBe(3);
  expect(await debugCount(b)).toBe(2);

  await ctxA.setOffline(false);
  await expect.poll(() => debugPending(a), { timeout: 15_000 }).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(5);
  await b.waitForTimeout(1000);
  expect(await debugCount(b)).toBe(5); // and no duplicates arrive later
  const state = await pageApi<{ elements: unknown[]; seq: number }>(
    b,
    'GET',
    `/boards/${boardId}/state`,
  );
  expect(state.elements).toHaveLength(5);
  expect(state.seq).toBe(5); // every op applied exactly once
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'synced');

  await ctxA.close();
  await ctxB.close();
});

// @api-restart: its own Playwright project, run after all other tests (playwright.config.ts)
test('API killed and restarted mid-session: both clients recover without a reload, nothing lost or duplicated @api-restart', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, boardId } = await twoUsersInRoom(browser);
  await a.evaluate(() => window.__rlDebug!.addRandomElements(5));
  await expect.poll(() => debugCount(b)).toBe(5);
  const urlA = a.url();

  await controlApi('stop');
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'reconnecting');
  await expect(b.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'reconnecting');
  await a.evaluate(() => window.__rlDebug!.addRandomElements(3)); // queued while the API is down
  await b.evaluate(() => window.__rlDebug!.moveElement());
  expect(await debugPending(a)).toBe(3);
  await controlApi('start');

  for (const p of [a, b]) {
    await expect(p.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'synced', {
      timeout: 30_000,
    });
  }
  await expect.poll(() => debugCount(a)).toBe(8);
  await expect.poll(() => debugCount(b)).toBe(8);
  expect(await debugPending(a)).toBe(0);
  expect(await debugPending(b)).toBe(0);
  expect(a.url()).toBe(urlA); // no reload / navigation
  const state = await pageApi<{ elements: unknown[]; seq: number }>(
    a,
    'GET',
    `/boards/${boardId}/state`,
  );
  expect(state.elements).toHaveLength(8);
  expect(state.seq).toBe(9); // 5 + 3 adds + 1 move — each applied once

  await ctxA.close();
  await ctxB.close();
});

test('E2E-6 kick: B gets the modal, lands on the dashboard and the room is not listed', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, roomId } = await twoUsersInRoom(browser);
  const members = await pageApi<{ items: { user: { id: string; username: string } }[] }>(
    a,
    'GET',
    `/rooms/${roomId}/members`,
  );
  const me = await pageApi<{ user: { id: string } }>(a, 'GET', '/me');
  const target = members.items.find((m) => m.user.id !== me.user.id)!;
  await pageApi(a, 'DELETE', `/rooms/${roomId}/members/${target.user.id}`);

  await expect(b.getByRole('dialog', { name: 'You were removed from this room' })).toBeVisible();
  await b.getByTestId('room-gone-dashboard').click();
  await expect(b).toHaveURL(/\/dashboard$/);
  await expect(b.getByText('No rooms yet')).toBeVisible(); // the list has loaded…
  await expect(b.locator(`a[href="/rooms/${roomId}"]`)).toHaveCount(0); // …without the room (E2E-6)
  await a.getByRole('tab', { name: 'Members' }).click();
  await expect(a.getByTestId('member-row')).toHaveCount(1);
  // E2E-6 + Phase 7: the room sees the system message
  await a.getByRole('tab', { name: 'Chat' }).click();
  await expect(
    a.getByTestId('chat-system').filter({ hasText: 'was removed from the room' }),
  ).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

/** Pans the map by dragging for `ms` and returns rAF frame-time stats. */
async function measurePan(page: Page, ms: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const until = Date.now() + ms;
  let dir = 1;
  while (Date.now() < until) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(cx + dir * i * 15, cy + dir * i * 8);
    await page.mouse.up();
    dir = -dir;
  }
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__stop = true;
    return w.__frames.slice(1);
  });
  const sorted = [...frames].sort((x, y) => x - y);
  const avg = frames.reduce((sum, f) => sum + f, 0) / frames.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  return {
    frames: frames.length,
    avg,
    summary: `${frames.length} frames · avg ${avg.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · max ${Math.max(...frames).toFixed(1)} ms`,
  };
}

test('performance: 1 000 mixed elements, pan for 5 s — average frame time', async ({ browser }) => {
  const { ctxA, ctxB, a } = await twoUsersInRoom(browser);
  await ctxB.close();
  await a.setViewportSize({ width: 1440, height: 900 });
  const baseline = await measurePan(a, 5000);

  // the client caps its unsynced queue at 500 ops (FEATURES F8), so add in two rounds
  for (let round = 0; round < 2; round++) {
    expect(await a.evaluate(() => window.__rlDebug!.addRandomElements(500))).toBe(500);
    await expect.poll(() => debugPending(a), { timeout: 30_000 }).toBe(0);
  }
  expect(await debugCount(a)).toBe(1000);
  await a.waitForTimeout(500);
  const loaded = await measurePan(a, 5000);

  console.log(`[perf] empty board, pan 5 s: ${baseline.summary}`);
  console.log(`[perf] 1000 elements, pan 5 s: ${loaded.summary}`);
  test
    .info()
    .annotations.push(
      { type: 'perf-baseline', description: baseline.summary },
      { type: 'perf-1000', description: loaded.summary },
    );
  expect(loaded.frames).toBeGreaterThan(30);
  // hard fail only far beyond the 16.7 ms target (TESTING §7: trend, fail on > 2× regression)
  expect(loaded.avg).toBeLessThan(Math.max(33.4, baseline.avg * 2));

  await ctxA.close();
});
