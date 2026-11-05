import { expect, test, type Page } from '@playwright/test';
import { pageApi, twoUsersInRoom } from './fixtures';

/**
 * Chat, pings, laser, follow & summon (Phase 7; FEATURES F8/F9, UI_UX_SPEC §3.5/§5) with two
 * browser contexts and real mouse / keyboard input.
 */

type XY = [number, number];

async function at(p: Page, fx: number, fy: number): Promise<XY> {
  const b = await p.locator('.leaflet-container').boundingBox();
  if (!b) throw new Error('no map');
  return [b.x + b.width * fx, b.y + b.height * fy];
}

async function say(p: Page, text: string) {
  const input = p.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const center = async (p: Page): Promise<XY> => {
  const v = await p.getByTestId('map-canvas').getAttribute('data-center');
  const [x, y] = (v ?? '').split(',').map(Number);
  return [x ?? NaN, y ?? NaN];
};

test('chat: send with Enter, Shift+Enter newline, counter after 400, delete own; "/" focuses the input', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  const input = a.getByRole('textbox', { name: 'Message' });

  await a.locator('.leaflet-container').click({ position: { x: 20, y: 300 } });
  await a.keyboard.press('/');
  await expect(input).toBeFocused();
  await a.keyboard.type('go school');
  await a.keyboard.press('Shift+Enter');
  await a.keyboard.type('then rotate north');
  await a.keyboard.press('Enter');
  const bodyB = b.getByTestId('chat-body').filter({ hasText: 'go school' });
  await expect(bodyB).toHaveText('go school\nthen rotate north');
  await expect(input).toHaveValue('');

  await input.fill('x'.repeat(401));
  await expect(a.getByTestId('chat-counter')).toHaveText('401/500');
  await input.fill('y'.repeat(501));
  await expect(a.getByRole('button', { name: 'Send' })).toBeDisabled();
  await input.fill('');

  // delete via the hover menu
  const mine = a.getByTestId('chat-message').filter({ hasText: 'go school' });
  await mine.hover();
  await mine.getByRole('button', { name: 'Message options' }).click();
  await a.getByRole('menuitem', { name: 'Delete message' }).click();
  await expect(b.getByTestId('chat-message').filter({ hasText: 'message deleted' })).toBeVisible();
  await expect(bodyB).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('XSS: an <img onerror> message renders as literal text — no element, no dialog, no CSP violation', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  let dialogs = 0;
  const cspViolations: string[] = [];
  for (const p of [a, b]) {
    p.on('dialog', (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    p.on('console', (m) => {
      if (/content security policy/i.test(m.text())) cspViolations.push(m.text());
    });
  }
  const payload = '<img src=x onerror=alert(1)>';
  await say(a, payload);
  const shown = b.getByTestId('chat-body').filter({ hasText: payload });
  await expect(shown).toHaveText(payload);
  await expect(b.getByTestId('chat-list').locator('img')).toHaveCount(0);
  await b.waitForTimeout(500);
  expect(dialogs).toBe(0);
  expect(cspViolations).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('unread badge appears while the panel is collapsed and clears when the chat is shown', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b } = await twoUsersInRoom(browser);
  await b.getByTestId('panel-toggle').click(); // collapse
  await say(a, 'one');
  await say(a, 'two');
  await expect(b.getByTestId('panel-toggle').getByTestId('unread-badge')).toHaveText('2');
  await b.getByTestId('panel-toggle').click();
  await expect(b.getByTestId('chat-body').filter({ hasText: 'two' })).toBeVisible();
  await expect(b.getByTestId('unread-badge')).toHaveCount(0);

  // another tab active → the badge sits on the Chat tab
  await b.getByRole('tab', { name: 'Members' }).click();
  await say(a, 'three');
  await expect(b.getByRole('tab', { name: /Chat/ }).getByTestId('unread-badge')).toHaveText('1');

  await ctxA.close();
  await ctxB.close();
});

test('E2E-4: B pings a spot on another board; A clicks the chip, switches board, flies there and sees the pulse', async ({
  browser,
}) => {
  // the focus ring after the fly-to is motion (reduced motion jumps without it): A opts in
  const { ctxA, ctxB, a, b, roomId } = await twoUsersInRoom(browser, {
    a: { reducedMotion: 'no-preference' },
  });
  await pageApi(a, 'POST', `/rooms/${roomId}/boards`, {
    name: 'Miramar – Drop B',
    mapId: 'miramar',
  });
  await b.getByRole('tab', { name: /Miramar – Drop B/ }).click();
  await expect(b.getByTestId('map-canvas')).toHaveAttribute('data-map', 'miramar');

  // 📍 → crosshair pick → chip in the input → send
  await b.getByTestId('ping-button').click();
  await expect(b.locator('.leaflet-container')).toHaveClass(/rl-ping-pick/);
  await b.mouse.click(...(await at(b, 0.38, 0.32))); // well inside the map square
  await expect(b.getByTestId('draft-ping')).toContainText('· Miramar – Drop B');
  await say(b, 'enemies here');
  // everyone on that board sees the 3 s pulse — B is
  await expect(b.locator('[data-testid="map-pulse"].rl-pulse-ping')).toHaveCount(1);

  const page = await pageApi<{ items: { body: string; ping: { x: number; y: number } | null }[] }>(
    a,
    'GET',
    `/rooms/${roomId}/messages`,
  );
  const ping = page.items.find((m) => m.body === 'enemies here')?.ping;
  expect(ping).toBeTruthy();

  const chip = a.getByTestId('ping-chip').filter({ hasText: 'Miramar – Drop B' });
  await expect(chip).toContainText('📍');
  await chip.click();
  await expect(a.getByTestId('map-canvas')).toHaveAttribute('data-map', 'miramar');
  await expect(a.locator('[data-testid="map-pulse"].rl-pulse-focus')).toHaveCount(1);
  await expect
    .poll(async () => {
      const [x, y] = await center(a);
      return Math.hypot(x - ping!.x, y - ping!.y);
    })
    .toBeLessThan(5_000); // within 50 m of the ping

  // Alt+click attaches a ping too, and focuses the input
  await a.keyboard.down('Alt');
  await a.mouse.click(...(await at(a, 0.6, 0.6)));
  await a.keyboard.up('Alt');
  await expect(a.getByTestId('draft-ping')).toBeVisible();
  await expect(a.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await a.getByRole('button', { name: 'Remove ping' }).click();
  await expect(a.getByTestId('draft-ping')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('laser: A holds K-laser over the map; B sees A’s trail, which fades', async ({ browser }) => {
  const { ctxA, ctxB, a, b, boardId } = await twoUsersInRoom(browser);
  const meA = await pageApi<{ user: { id: string } }>(a, 'GET', '/me');
  await a.keyboard.press('k');
  await expect(a.getByTestId('tool-laser')).toHaveAttribute('aria-pressed', 'true');
  await a.mouse.move(...(await at(a, 0.3, 0.3)));
  await a.mouse.down();
  await a.mouse.move(...(await at(a, 0.6, 0.5)), { steps: 20 });
  await expect
    .poll(() => b.evaluate(() => window.__rlDebug?.laserUsers() ?? []))
    .toContain(meA.user.id);
  await a.mouse.up();
  await expect(b.getByTestId('laser-canvas')).toHaveCount(1);
  // never persisted: gone after the 1.5 s lifetime
  await expect
    .poll(() => b.evaluate(() => window.__rlDebug?.laserUsers() ?? []), { timeout: 5_000 })
    .toEqual([]);
  const state = await pageApi<{ elements: unknown[] }>(b, 'GET', `/boards/${boardId}/state`);
  expect(state.elements).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('summon: A summons, B follows A to another board and A’s pans; B pans manually → follow stops', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameA, roomId } = await twoUsersInRoom(browser);
  await pageApi(a, 'POST', `/rooms/${roomId}/boards`, {
    name: 'Miramar – Drop B',
    mapId: 'miramar',
  });
  await expect(b.getByRole('tab', { name: /Miramar – Drop B/ })).toBeVisible();

  await a.locator(`[data-testid="presence-avatar"][data-user="${nameA}"]`).click();
  await a.getByRole('menuitem', { name: 'Summon everyone' }).click();
  await expect(b.getByText(`${nameA} is presenting — following`)).toBeVisible();
  await expect(b.getByTestId('follow-pill')).toContainText(`Following ${nameA}`);

  // A goes to the other board and pans: B comes along
  await a.getByRole('tab', { name: /Miramar – Drop B/ }).click();
  await expect(a.getByTestId('map-canvas')).toHaveAttribute('data-map', 'miramar');
  await expect(b.getByTestId('map-canvas')).toHaveAttribute('data-map', 'miramar');
  const from = await at(a, 0.5, 0.5);
  await a.mouse.move(...from);
  await a.mouse.down();
  await a.mouse.move(from[0] - 220, from[1] - 140, { steps: 12 });
  await a.mouse.up();
  await expect
    .poll(async () => {
      const [ax, ay] = await center(a);
      const [bx, by] = await center(b);
      return Math.hypot(ax - bx, ay - by);
    })
    .toBeLessThan(3_000);

  // B pans by hand → stops following
  const bFrom = await at(b, 0.5, 0.5);
  await b.mouse.move(...bFrom);
  await b.mouse.down();
  await b.mouse.move(bFrom[0] + 150, bFrom[1] + 80, { steps: 8 });
  await b.mouse.up();
  await expect(b.getByText('Stopped following')).toBeVisible();
  await expect(b.getByTestId('follow-pill')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test('follow from the avatar menu; the leader leaving stops it with a toast', async ({
  browser,
}) => {
  const { ctxA, ctxB, a, b, nameA } = await twoUsersInRoom(browser);
  await b.locator(`[data-testid="presence-avatar"][data-user="${nameA}"]`).click();
  await b.getByRole('menuitem', { name: `Follow ${nameA}` }).click();
  await expect(b.getByTestId('follow-pill')).toBeVisible();
  await a.goto('/dashboard'); // leader leaves the room
  await expect(b.getByText(`${nameA} left — stopped following`)).toBeVisible();
  await expect(b.getByTestId('follow-pill')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
