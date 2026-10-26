import { expect, test, type Page } from '@playwright/test';
import { debugCount, debugPending, pageApi, twoUsersInRoom } from './fixtures';

/**
 * Drawing tools (Phase 6; FEATURES F5/F6, UI_UX_SPEC §3.5/§6/§8) with two browser contexts
 * and real mouse / keyboard input. Element positions are read back through the dev/E2E debug
 * hook only to compare what both users see.
 */

type XY = [number, number];

async function mapBox(p: Page) {
  const box = await p.locator('.leaflet-container').boundingBox();
  if (!box) throw new Error('no map');
  return box;
}

/** a point at a fraction of the map viewport (kept away from the edges and the style bar) */
async function at(p: Page, fx: number, fy: number): Promise<XY> {
  const b = await mapBox(p);
  return [b.x + b.width * fx, b.y + b.height * fy];
}

async function drag(p: Page, from: XY, to: XY, opts: { shift?: boolean; steps?: number } = {}) {
  await p.mouse.move(...from);
  if (opts.shift) await p.keyboard.down('Shift');
  await p.mouse.down();
  await p.mouse.move(...to, { steps: opts.steps ?? 10 });
  await p.mouse.up();
  if (opts.shift) await p.keyboard.up('Shift');
}

async function click(p: Page, xy: XY) {
  await p.mouse.click(...xy);
}

/** centre of the n-th marker icon on screen */
async function markerCenter(p: Page, n = 0): Promise<XY> {
  const box = await p.locator('.rl-marker svg').nth(n).boundingBox();
  if (!box) throw new Error('no marker');
  return [box.x + box.width / 2, box.y + box.height / 2];
}

const elements = (p: Page) => p.evaluate(() => window.__rlDebug?.elements() ?? []);
const geometryOf = (p: Page, id: string) => p.evaluate((i) => window.__rlDebug?.geometry(i), id);
const selection = (p: Page) => p.evaluate(() => window.__rlDebug?.selection() ?? []);
const layerRows = (p: Page) =>
  p.getByTestId('layer-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-layer')));

async function openLayers(p: Page) {
  await p.getByRole('tab', { name: 'Layers' }).click();
  await expect(p.getByTestId('layer-row').first()).toBeVisible();
}

async function placeMarker(p: Page, xy: XY) {
  await p.keyboard.press('m');
  await click(p, xy);
}

/** waits until A's ops are acknowledged and B has `n` elements */
async function synced(a: Page, b: Page, n: number) {
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(n);
}

test('E2E-3: A draws arrow, circle, enemy marker; B sees all three within 1 s; B moves the marker, A sees it', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);

  await a.keyboard.press('a'); // arrow: press-drag-release = straight arrow
  await drag(a, await at(a, 0.2, 0.3), await at(a, 0.4, 0.35));
  await a.keyboard.press('c'); // circle: press at centre, drag radius
  await drag(a, await at(a, 0.6, 0.3), await at(a, 0.68, 0.3));
  await placeMarker(a, await at(a, 0.45, 0.6)); // default kind: enemy squad
  const placed = Date.now();
  expect(await debugCount(a)).toBe(3); // all three drawn (shown locally at once)

  await expect.poll(() => debugCount(b), { timeout: 1000, intervals: [25] }).toBe(3);
  test.info().annotations.push({ type: 'e2e-3', description: `${Date.now() - placed} ms` });
  const types = (await elements(b)).map((e) => e.type).sort();
  expect(types).toEqual(['ARROW', 'CIRCLE', 'MARKER']);
  const m = (await elements(b)).find((e) => e.type === 'MARKER')!;
  expect(m.props).toMatchObject({ kind: 'enemy_squad', number: 1 });

  // B selects the marker and drags it
  await b.keyboard.press('v');
  const start = await markerCenter(b);
  await drag(b, start, [start[0] + 120, start[1] + 40]);
  await expect.poll(() => debugPending(b)).toBe(0);
  const moved = await geometryOf(b, m.id);
  expect(moved).not.toEqual(m.geometry);
  await expect.poll(() => geometryOf(a, m.id)).toEqual(moved);

  await ctxA.close();
  await ctxB.close();
});

test('select + move a marker syncs; undo puts it back for both; redo moves it again', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await placeMarker(a, await at(a, 0.4, 0.4));
  await synced(a, b, 1);
  const [m] = await elements(a);
  const original = m!.geometry;

  await a.keyboard.press('v');
  const c = await markerCenter(a);
  await drag(a, c, [c[0] + 150, c[1] + 60]);
  await expect(a.getByTestId('selection-count')).toHaveText('1 selected');
  await expect.poll(() => debugPending(a)).toBe(0);
  const moved = await geometryOf(a, m!.id);
  expect(moved).not.toEqual(original);
  await expect.poll(() => geometryOf(b, m!.id)).toEqual(moved);

  await a.keyboard.press('Control+z');
  await expect.poll(() => geometryOf(a, m!.id)).toEqual(original);
  await expect.poll(() => geometryOf(b, m!.id)).toEqual(original);

  await expect(a.getByTestId('redo')).not.toHaveAttribute('aria-disabled', 'true');
  await a.keyboard.press('Control+Shift+z');
  await expect.poll(() => geometryOf(a, m!.id)).toEqual(moved);
  await expect.poll(() => geometryOf(b, m!.id)).toEqual(moved);

  // the toolbar buttons do the same
  await a.getByTestId('undo').click();
  await expect.poll(() => geometryOf(b, m!.id)).toEqual(original);
  await a.getByTestId('redo').click();
  await expect.poll(() => geometryOf(b, m!.id)).toEqual(moved);

  await ctxA.close();
  await ctxB.close();
});

test('undo of something B changed since: A gets "Changed by B" and B’s change stays', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameB } = await twoUsersInRoom(browser);
  await placeMarker(a, await at(a, 0.4, 0.4));
  await synced(a, b, 1);
  const [m] = await elements(a);

  await a.keyboard.press('v');
  const c = await markerCenter(a);
  await drag(a, c, [c[0] + 100, c[1]]);
  await expect.poll(() => debugPending(a)).toBe(0);
  await expect.poll(() => geometryOf(b, m!.id)).toEqual(await geometryOf(a, m!.id));

  await b.keyboard.press('v');
  const cb = await markerCenter(b);
  await drag(b, cb, [cb[0], cb[1] + 120]);
  await expect.poll(() => debugPending(b)).toBe(0);
  const byB = await geometryOf(b, m!.id);
  await expect.poll(() => geometryOf(a, m!.id)).toEqual(byB);

  await a.keyboard.press('Escape');
  await a.keyboard.press('Control+z');
  await expect(a.getByText(`Changed by ${nameB}`)).toBeVisible();
  await a.waitForTimeout(500);
  expect(await geometryOf(a, m!.id)).toEqual(byB);
  expect(await geometryOf(b, m!.id)).toEqual(byB);

  await ctxA.close();
  await ctxB.close();
});

test('eraser sweep removes 3 elements for both users in one batch', async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await a.keyboard.press('l');
  for (const fx of [0.3, 0.4, 0.5]) await drag(a, await at(a, fx, 0.25), await at(a, fx, 0.55));
  await synced(a, b, 3);

  await a.keyboard.press('e');
  await drag(a, await at(a, 0.25, 0.4), await at(a, 0.55, 0.4), { steps: 3 }); // fast sweep
  await expect.poll(() => debugCount(a)).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(0);
  // one undo brings all three back
  await a.keyboard.press('Control+z');
  await expect.poll(() => debugCount(b)).toBe(3);

  await ctxA.close();
  await ctxB.close();
});

test('E2E-9: owner locks a layer — the editor can’t select, erase or draw on it; their lock toggle is read-only', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, boardId } = await twoUsersInRoom(browser);
  await placeMarker(a, await at(a, 0.4, 0.4)); // on "Plan", the default active layer
  await synced(a, b, 1);

  await openLayers(a);
  await openLayers(b);
  const planA = a.locator('[data-testid="layer-row"][data-layer="Plan"]');
  await planA.getByTestId('layer-lock').click();
  const planB = b.locator('[data-testid="layer-row"][data-layer="Plan"]');
  await expect(planB).toHaveAttribute('data-locked', 'true');

  // the editor has no lock button, only a read-only icon
  await expect(b.getByTestId('layer-lock')).toHaveCount(0);
  await expect(planB.getByTestId('layer-lock-readonly')).toHaveAttribute(
    'aria-label',
    'Locked by the owner',
  );

  // select: nothing gets selected
  await b.keyboard.press('v');
  await click(b, await markerCenter(b));
  await expect(b.getByText('Layer “Plan” is locked')).toBeVisible();
  expect(await selection(b)).toEqual([]);
  await expect(b.getByTestId('selection-count')).toHaveCount(0);

  // eraser: nothing gets deleted
  await b.keyboard.press('e');
  await click(b, await markerCenter(b));
  await drag(b, await at(b, 0.3, 0.4), await at(b, 0.5, 0.4));
  await b.waitForTimeout(500);
  expect(await debugCount(b)).toBe(1);

  // drawing on it: refused
  await planB.getByRole('button', { name: /^Plan/ }).click();
  await expect(planB).toHaveAttribute('data-active', 'true');
  await placeMarker(b, await at(b, 0.6, 0.6));
  await b.waitForTimeout(500);
  expect(await debugCount(b)).toBe(1);
  expect(await debugCount(a)).toBe(1);

  // and the server agrees: a crafted delete is refused
  const [m] = await elements(b);
  const res = await b.evaluate(
    ({ id, boardId }) =>
      window.__rlDebug!.emit('element:delete', {
        opId: crypto.randomUUID(),
        boardId,
        elementId: id,
      }),
    { id: m!.id, boardId },
  );
  expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await debugCount(a)).toBe(1);

  await ctxA.close();
  await ctxB.close();
});

test('layers: reorder and visibility sync; Alt+click hides a layer only for that user', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await placeMarker(a, await at(a, 0.4, 0.4)); // on Plan
  await synced(a, b, 1);
  await openLayers(a);
  await openLayers(b);
  expect(await layerRows(a)).toEqual(['Zones', 'Enemies', 'Plan']); // top-most first

  // reorder: drag Plan to the top
  const rowA = (name: string) => a.locator(`[data-testid="layer-row"][data-layer="${name}"]`);
  await rowA('Plan').dragTo(rowA('Zones'));
  await expect.poll(() => layerRows(a)).toEqual(['Plan', 'Zones', 'Enemies']);
  await expect.poll(() => layerRows(b)).toEqual(['Plan', 'Zones', 'Enemies']);

  // board-wide visibility
  await rowA('Plan').getByTestId('layer-eye').click();
  const rowB = (name: string) => b.locator(`[data-testid="layer-row"][data-layer="${name}"]`);
  await expect(rowB('Plan')).toHaveAttribute('data-visible', 'false');
  await expect(b.locator('.rl-marker')).toHaveCount(0);
  await rowA('Plan').getByTestId('layer-eye').click();
  await expect(rowB('Plan')).toHaveAttribute('data-visible', 'true');
  await expect(b.locator('.rl-marker')).toHaveCount(1);

  // Alt+click: hidden for B only
  await rowB('Plan')
    .getByTestId('layer-eye')
    .click({ modifiers: ['Alt'] });
  await expect(rowB('Plan')).toHaveAttribute('data-local-hidden', 'true');
  await expect(b.locator('.rl-marker')).toHaveCount(0);
  await a.waitForTimeout(500);
  await expect(rowA('Plan')).toHaveAttribute('data-visible', 'true');
  await expect(rowA('Plan')).toHaveAttribute('data-local-hidden', 'false');
  await expect(a.locator('.rl-marker')).toHaveCount(1);

  // add + rename + delete (confirm shows the element count)
  await a.getByRole('button', { name: 'Add layer' }).click();
  await expect.poll(() => layerRows(b)).toHaveLength(4);
  await rowA('Zones').getByTestId('layer-menu').click();
  await a.getByRole('menuitem', { name: 'Delete layer' }).click();
  await expect(a.getByRole('dialog', { name: 'Delete layer' })).toContainText('0 elements');
  await a.getByTestId('confirm-layer-action').click();
  await expect.poll(() => layerRows(b)).toHaveLength(3);

  await ctxA.close();
  await ctxB.close();
});

test('shortcuts: Ctrl+A, Ctrl+D, Delete work; ? opens the help dialog; typing in a field is ignored', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await placeMarker(a, await at(a, 0.35, 0.4));
  await click(a, await at(a, 0.55, 0.45));
  await synced(a, b, 2);

  await a.keyboard.press('Control+a');
  await expect(a.getByTestId('selection-count')).toHaveText('2 selected');
  const before = (await elements(a)).map((e) => e.geometry);

  await a.keyboard.press('Control+d');
  await expect.poll(() => debugCount(b)).toBe(4);
  await expect(a.getByTestId('selection-count')).toHaveText('2 selected'); // the copies
  const copies = (await elements(a)).filter(
    (e) => !before.some((g) => JSON.stringify(g) === JSON.stringify(e.geometry)),
  );
  expect(copies).toHaveLength(2);
  for (const c of copies) {
    const [x, y] = (c.geometry as { at: [number, number] }).at;
    expect(
      before.some((g) => {
        const [bx, by] = (g as { at: [number, number] }).at;
        return x - bx === 2000 && y - by === 2000;
      }),
    ).toBe(true);
  }

  await a.keyboard.press('Delete');
  await expect.poll(() => debugCount(b)).toBe(2);

  // typing in an input never triggers a shortcut
  await a.keyboard.press('m');
  const label = a.getByRole('textbox', { name: 'Marker label' });
  await label.fill('verde');
  await label.press('Backspace');
  await label.press('v');
  await expect(a.getByTestId('tool-marker')).toHaveAttribute('aria-pressed', 'true');
  expect(await debugCount(a)).toBe(2);

  // leave the field (without clicking anything), then ? opens the help
  await label.evaluate((el) => {
    el.blur();
  });
  await a.keyboard.press('Shift+?');
  await expect(a.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(a.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText(
    'Duplicate selection',
  );

  await ctxA.close();
  await ctxB.close();
});

test('E2E-5: a viewer sees 3 tools, and a crafted socket emit is rejected', async ({ browser }) => {
  const { ctxA, ctxB, a, b, roomId, boardId } = await twoUsersInRoom(browser);
  const members = await pageApi<{ items: { user: { id: string } }[] }>(
    a,
    'GET',
    `/rooms/${roomId}/members`,
  );
  const me = await pageApi<{ user: { id: string } }>(a, 'GET', '/me');
  const target = members.items.find((m) => m.user.id !== me.user.id)!;
  await pageApi(a, 'PATCH', `/rooms/${roomId}/members/${target.user.id}`, { role: 'VIEWER' });

  await expect(b.getByTestId('toolbar').locator('[data-tool-button]')).toHaveCount(3);
  await expect(b.getByTestId('tool-select')).toBeVisible();
  await expect(b.getByTestId('tool-measure')).toBeVisible();
  await expect(b.getByTestId('tool-laser')).toBeVisible();
  await expect(b.getByTestId('undo')).toHaveCount(0);
  await expect(b.getByTestId('view-only')).toBeVisible();
  await b.keyboard.press('p'); // pen shortcut does nothing for a viewer
  await expect(b.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

  const layerId = await b.evaluate(() => window.__rlDebug!.layers()[0]!.id);
  const res = await b.evaluate(
    ({ boardId, layerId }) =>
      window.__rlDebug!.emit('element:upsert', {
        opId: crypto.randomUUID(),
        boardId,
        element: {
          id: crypto.randomUUID(),
          boardId,
          layerId,
          type: 'MARKER',
          geometry: { at: [1000, 1000] },
          style: { color: '#EF4444', width: 4, dashed: false, fillOpacity: 0 },
          props: { kind: 'pin' },
          z: 0,
        },
      }),
    { boardId, layerId },
  );
  expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  await a.waitForTimeout(300);
  expect(await debugCount(a)).toBe(0);

  await ctxA.close();
  await ctxB.close();
});

test('E2E-8: offline, A draws 3 shapes with the tools; back online B receives exactly 3', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, boardId } = await twoUsersInRoom(browser);
  await ctxA.setOffline(true);
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('data-state', 'offline');
  await a.keyboard.press('p');
  await drag(a, await at(a, 0.2, 0.3), await at(a, 0.35, 0.45), { steps: 15 });
  await a.keyboard.press('l');
  await drag(a, await at(a, 0.4, 0.3), await at(a, 0.55, 0.3));
  await placeMarker(a, await at(a, 0.6, 0.5));
  expect(await debugCount(a)).toBe(3);
  expect(await debugPending(a)).toBe(3);
  await a.waitForTimeout(500);
  expect(await debugCount(b)).toBe(0);

  await ctxA.setOffline(false);
  await expect.poll(() => debugPending(a), { timeout: 15_000 }).toBe(0);
  await expect.poll(() => debugCount(b)).toBe(3);
  await b.waitForTimeout(800);
  expect(await debugCount(b)).toBe(3);
  const state = await pageApi<{ elements: unknown[] }>(b, 'GET', `/boards/${boardId}/state`);
  expect(state.elements).toHaveLength(3);

  await ctxA.close();
  await ctxB.close();
});

test('B sees A’s stroke:preview ghost while A draws; double-click edits a text label in place', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);

  // ghost: A holds the pen down mid-stroke
  await a.keyboard.press('p');
  await a.mouse.move(...(await at(a, 0.3, 0.3)));
  await a.mouse.down();
  await a.mouse.move(...(await at(a, 0.45, 0.4)), { steps: 12 });
  await expect(b.locator('path.rl-ghost')).toHaveCount(1);
  await a.mouse.up();
  await expect(b.locator('path.rl-ghost')).toHaveCount(0); // the committed stroke replaces it
  await expect.poll(() => debugCount(b)).toBe(1);

  // text: create, then double-click with Select to edit
  await a.keyboard.press('t');
  await click(a, await at(a, 0.5, 0.6));
  await a.getByRole('textbox', { name: 'Text label' }).fill('go school');
  await a.keyboard.press('Enter');
  await expect.poll(() => debugCount(b)).toBe(2);
  await a.keyboard.press('v');
  // labels are pointer-events: none (the tools hit-test in world units), so click by position
  const tb = (await a.locator('.rl-text', { hasText: 'go school' }).boundingBox())!;
  await a.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height / 2);
  const edit = a.getByRole('textbox', { name: 'Edit text' });
  await expect(edit).toHaveValue('go school');
  await edit.fill('rotate north');
  await edit.press('Enter');
  await expect(b.locator('.rl-text', { hasText: 'rotate north' })).toBeVisible();
  // one undo step restores the old text
  await a.keyboard.press('Control+z');
  await expect(b.locator('.rl-text', { hasText: 'go school' })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
