import { expect, test } from '@playwright/test';
import { twoUsersInRoom } from './fixtures';

/** Spotter, the built-in help bot (UI_UX_SPEC §3.10): answers from the bundled knowledge base. */
test('Spotter on the landing page: free text, a suggestion chip, the fallback, Esc', async ({
  page,
}) => {
  await page.goto('/');
  const launcher = page.getByTestId('spotter-launcher');
  await launcher.click();
  const panel = page.getByTestId('spotter-panel');
  await expect(panel).toBeVisible();
  const input = panel.getByLabel('Your question');
  await expect(input).toBeFocused();

  await input.fill('where should we land on erangel');
  await input.press('Enter');
  const log = panel.getByRole('log');
  await expect(log).toContainText('Pochinki');
  await expect(panel.getByRole('link', { name: /open erangel/i })).toHaveAttribute(
    'href',
    '/explore?map=erangel',
  );

  await panel.getByRole('button', { name: 'How do we cross the Erangel bridges?' }).click();
  await expect(log).toContainText('camp spots');

  await input.fill('what is the capital of france');
  await input.press('Enter');
  await expect(log).toContainText("I don't know that one yet");

  await input.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(launcher).toBeFocused();

  // the conversation survives closing and reopening
  await launcher.click();
  await expect(page.getByTestId('spotter-panel').getByRole('log')).toContainText('Pochinki');
});

test('Spotter in the room: the top-bar button opens it; Esc on the map is left alone', async ({
  browser,
}) => {
  const { ctxA, ctxB, a } = await twoUsersInRoom(browser);
  await expect(a.getByTestId('spotter-launcher')).toHaveCount(0); // the map's corners are taken
  await a.getByTestId('spotter-room-button').click();
  const panel = a.getByTestId('spotter-panel');
  await panel.getByLabel('Your question').fill('how do i invite my squad');
  await panel.getByLabel('Your question').press('Enter');
  await expect(panel.getByRole('log')).toContainText('press "Invite" in the top bar');

  await a.locator('.leaflet-container').click({ position: { x: 40, y: 40 } });
  await a.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close Spotter' }).click();
  await expect(panel).toHaveCount(0);
  await ctxA.close();
  await ctxB.close();
});

test('map links (header, Spotter) open Explore on that map — /maps/* is a dev-only page', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Miramar' })
    .click();
  await expect(page).toHaveURL(/\/explore\?map=miramar$/);
  await expect(page.getByTestId('explore-map-miramar')).toHaveAttribute('aria-pressed', 'true');
});
