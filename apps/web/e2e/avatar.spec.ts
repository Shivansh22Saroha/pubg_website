import { expect, test } from '@playwright/test';
import { makePng, twoUsersInRoom } from './fixtures';

/**
 * Profile photos (FEATURES F23): upload one in Settings, a teammate sees it in the room's
 * member list, and removing it brings the initials back.
 */
test('E2E-R3: profile photo — upload, teammate sees it, remove', async ({ browser }) => {
  const { ctxA, ctxB, a, b, roomId, nameA } = await twoUsersInRoom(browser);

  await a.goto('/settings');
  await a.getByTestId('avatar-file').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: makePng(400, 300),
  });
  await expect(a.getByText('Profile photo updated')).toBeVisible();
  const menuPhoto = a.locator('header [data-photo="true"] img').first();
  await expect(menuPhoto).toBeVisible();
  await expect
    .poll(() => menuPhoto.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(256);
  await expect(a.getByRole('button', { name: 'Change photo' })).toBeVisible();

  // the teammate's member list shows it (after a reload: lists load with the room)
  await b.goto(`/rooms/${roomId}`);
  await b.getByRole('tab', { name: 'Members' }).click();
  const row = b.getByTestId('member-row').filter({ hasText: nameA });
  await expect(row.locator('[data-photo="true"] img')).toBeVisible();

  await a.getByRole('button', { name: 'Remove photo' }).click();
  await expect(a.getByText('Profile photo removed')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Upload photo' })).toBeVisible();
  await expect(a.locator('[data-photo="true"]')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
