import { expect, test } from '@playwright/test';
import { registerViaUi, serveFixtureTiles, uniqueName } from './fixtures';

/**
 * E2E-2 (TESTING §6; UF-3 + UF-4 + UF-5), without realtime presence (Phase 5): the owner
 * creates a room and copies an invite; a second browser context signs up via the invite link
 * and joins; both see each other in the members list.
 */
test('E2E-2: create room, invite, second user joins, both see each other', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const joinerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const joiner = await joinerCtx.newPage();
  await serveFixtureTiles(owner);
  await serveFixtureTiles(joiner);
  const ownerName = uniqueName('own');
  const joinerName = uniqueName('join');
  const roomName = `Scrims ${Date.now().toString(36)}`;

  // UF-3: owner creates a room on Miramar
  await registerViaUi(owner, ownerName);
  await expect(owner.getByText('No rooms yet')).toBeVisible();
  await owner.getByRole('button', { name: 'New room' }).first().click();
  const dialog = owner.getByRole('dialog', { name: 'New room' });
  await dialog.getByLabel('Name').fill(roomName);
  await dialog.getByText('Miramar', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Create room' }).click();

  await expect(owner).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
  const roomPath = new URL(owner.url()).pathname;
  await expect(owner.getByTestId('room-name')).toHaveText(roomName);
  await expect(owner.getByRole('tab', { name: /Miramar – Plan 1/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(owner.locator('.leaflet-container')).toBeVisible(); // map of the active board

  // UF-4: invite dialog opens with a fresh 24 h link + formatted code
  await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  const link = owner.getByTestId('invite-link');
  await expect(link).toHaveValue(/\/join\/[0-9A-HJKMNP-TV-Z]{10}$/);
  const inviteUrl = await link.inputValue();
  await expect(owner.getByTestId('invite-code')).toHaveText(
    /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/,
  );
  await owner.keyboard.press('Escape');

  // UF-5: second user opens the link logged out → registers → back on the invite → joins
  await joiner.goto(new URL(inviteUrl).pathname);
  await expect(joiner.getByTestId('join-room-name')).toHaveText(roomName);
  await expect(joiner.getByText(`by ${ownerName}`)).toBeVisible();
  await joiner.getByRole('link', { name: 'Create an account' }).click();
  await joiner.getByLabel('Email').fill(`${joinerName}@example.com`);
  await joiner.getByLabel('Username').fill(joinerName);
  await joiner.getByLabel('Password', { exact: true }).fill('correct horse battery staple');
  await joiner.getByLabel('Confirm password').fill('correct horse battery staple');
  await joiner.getByRole('button', { name: 'Create account' }).click();
  await expect(joiner).toHaveURL(/\/join\//);
  await joiner.getByRole('button', { name: 'Join room' }).click();

  await expect(joiner).toHaveURL(new RegExp(`${roomPath}$`));
  await expect(joiner.getByTestId('room-name')).toHaveText(roomName);

  // both see each other (members list; the panel opens on Chat since Phase 7)
  await joiner.getByRole('tab', { name: 'Members' }).click();
  const joinerMembers = joiner.getByTestId('member-row');
  await expect(joinerMembers).toHaveCount(2);
  await expect(joinerMembers.filter({ hasText: ownerName })).toContainText('Owner');
  await expect(joinerMembers.filter({ hasText: joinerName })).toContainText('Editor');
  // a non-owner sees no invite-management / settings controls beyond their role
  await expect(joiner.getByRole('button', { name: 'Room settings' })).toHaveCount(0);

  await owner.reload();
  await owner.getByRole('tab', { name: 'Members' }).click();
  const ownerMembers = owner.getByTestId('member-row');
  await expect(ownerMembers).toHaveCount(2);
  await expect(owner.getByLabel(`Role of ${joinerName}`)).toHaveValue('EDITOR');

  // the room shows up on the joiner's dashboard
  await joiner.goto('/dashboard');
  await expect(joiner.getByRole('link', { name: new RegExp(roomName) }).first()).toBeVisible();

  // re-opening the invite as a member goes straight into the room
  await joiner.goto(new URL(inviteUrl).pathname);
  await joiner.getByRole('button', { name: 'Join room' }).click();
  await expect(joiner).toHaveURL(new RegExp(`${roomPath}$`));

  await ownerCtx.close();
  await joinerCtx.close();
});

test('join with code from the dashboard accepts dashed lower-case codes', async ({ page }) => {
  await serveFixtureTiles(page);
  await registerViaUi(page, uniqueName('code'));
  await page.getByLabel('Have an invite code?').fill('zzzz-zzzz-zz');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL(/\/join\/ZZZZZZZZZZ$/);
  await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible();
});
