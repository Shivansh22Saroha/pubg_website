import { devices, expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { twoUsersInRoom } from './fixtures';

/**
 * Voice chat (FEATURES F19): two real Chromium peers with fake microphones (a beeping tone),
 * connected peer-to-peer on localhost. Checks the media link actually comes up and audio
 * arrives (the speaking ring), not just the signalling.
 */
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

const MIC: BrowserContextOptions = { permissions: ['microphone'] };
const PHONE: BrowserContextOptions = (() => {
  const { defaultBrowserType: _webkit, ...rest } = devices['iPhone 13'];
  return { ...rest, ...MIC };
})();

const row = (p: Page, username: string) =>
  p.locator(`[data-testid="voice-panel"] [data-testid="voice-row"][data-user="${username}"]`);

async function openPanel(p: Page) {
  if (!(await p.getByTestId('voice-panel').isVisible()))
    await p.getByTestId('voice-people').click();
  await expect(p.getByTestId('voice-panel')).toBeVisible();
}

test('E2E-V1: two teammates join voice, connect, hear each other, mute and leave', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { ctxA, ctxB, a, b, nameA, nameB } = await twoUsersInRoom(browser, { a: MIC, b: MIC });

  // A joins: muted, alone
  await a.getByTestId('voice-join').click();
  await expect(a.getByTestId('voice-controls')).toBeVisible();
  await expect(a.getByTestId('voice-mic')).toHaveAttribute('data-live', 'false');
  // B sees one teammate in voice before joining
  await expect(b.getByTestId('voice-join')).toHaveAccessibleName('Join voice, 1 in voice');

  await b.getByTestId('voice-join').click();
  await expect(b.getByTestId('voice-controls')).toBeVisible();

  // both sides list both people, and the media link to the other comes up
  await openPanel(a);
  await openPanel(b);
  await expect(a.getByTestId('voice-row')).toHaveCount(2);
  await expect(row(a, nameB)).toHaveAttribute('data-link', 'connected', { timeout: 20_000 });
  await expect(row(b, nameA)).toHaveAttribute('data-link', 'connected', { timeout: 20_000 });
  await expect(row(b, nameA).getByRole('img', { name: 'Muted' })).toBeVisible();

  // A unmutes: B's row for A loses the muted icon and lights up when the beep arrives
  await a.keyboard.press('Escape'); // close A's panel
  await a.getByTestId('voice-mic').click();
  await expect(a.getByTestId('voice-mic')).toHaveAttribute('data-live', 'true');
  await expect(row(b, nameA).getByRole('img', { name: 'Muted' })).toHaveCount(0);
  await expect(row(b, nameA)).toHaveAttribute('data-speaking', 'true', { timeout: 15_000 });

  // Shift+M mutes again
  await a
    .locator('body')
    .click({ position: { x: 5, y: 300 } })
    .catch(() => undefined);
  await a.keyboard.press('Shift+M');
  await expect(a.getByTestId('voice-mic')).toHaveAttribute('data-live', 'false');
  await expect(row(b, nameA).getByRole('img', { name: 'Muted' })).toBeVisible();

  // A leaves: B is alone
  await a.getByTestId('voice-leave').click();
  await expect(a.getByTestId('voice-join')).toBeVisible();
  await expect(b.getByTestId('voice-row')).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});

test('E2E-V2: phone — join from the room menu, floating controls fit, leave', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { ctxA, ctxB, a } = await twoUsersInRoom(browser, { a: PHONE, b: MIC });
  await a.getByTestId('room-menu').tap();
  await a.getByRole('menuitem', { name: 'Join voice' }).tap();
  const dock = a.getByTestId('voice-dock');
  await expect(dock).toBeVisible();
  const box = await dock.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // touch targets
  const mic = await a.getByTestId('voice-mic').boundingBox();
  expect(mic?.height ?? 0).toBeGreaterThanOrEqual(44);

  await a.getByTestId('voice-leave').tap();
  await expect(dock).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});
