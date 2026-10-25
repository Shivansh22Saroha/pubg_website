import { expect, test, type Page } from '@playwright/test';

/**
 * E2E-1 (TESTING §6, UF-1 + UF-2): register → dashboard → logout → login.
 * Also proves tokens never reach JS storage or a URL, and cookies are httpOnly.
 */
const password = 'correct horse battery staple';

async function storageIsEmpty(page: Page) {
  return page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0);
}

test('E2E-1: register, land on dashboard, log out, log back in', async ({ page, context }) => {
  const id = `e2e_${Date.now().toString(36)}`; // ≤ 20 chars, unique per run
  const email = `${id}@example.com`;
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));

  // protected page without a session → login, with a safe redirectTo
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?redirectTo=%2Fdashboard$/);

  // register (UF-1)
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Username').fill(id);
  await expect(page.getByTestId('username-availability')).toContainText('available');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await expect(page.getByText(/^(Good|Strong)$/)).toBeVisible(); // strength meter
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('dashboard-greeting')).toHaveText(`Welcome, ${id}`);

  // cookies are httpOnly and nothing is in JS storage
  const cookies = await context.cookies();
  const auth = cookies.filter((c) => /rl_(at|rt)$/.test(c.name));
  expect(auth.map((c) => c.name).sort()).toEqual(['rl_at', 'rl_rt']);
  expect(auth.every((c) => c.httpOnly)).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/rl_(at|rt)/);
  expect(await storageIsEmpty(page)).toBe(true);

  // log out (UF-2)
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await context.cookies()).filter((c) => /rl_(at|rt)$/.test(c.name))).toEqual([]);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?redirectTo=/);

  // wrong password → generic error, no cookies
  await page.getByLabel('Email or username').fill(id);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('form-error')).toHaveText(
    'Email/username or password is incorrect',
  );

  // log in by username → back to the dashboard
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('dashboard-greeting')).toHaveText(`Welcome, ${id}`);

  // a missing access cookie with a live refresh cookie is restored silently via /login
  await context.clearCookies({ name: 'rl_at' });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

  // no secret ever appeared in a URL, and storage stayed empty
  const tokenValues = (await context.cookies())
    .filter((c) => /rl_(at|rt)$/.test(c.name))
    .map((c) => c.value);
  for (const url of urls) {
    expect(url).not.toContain(password.replaceAll(' ', '%20'));
    expect(url).not.toContain(password);
    for (const t of tokenValues) expect(url).not.toContain(t);
  }
  expect(await storageIsEmpty(page)).toBe(true);
});

test('redirectTo cannot send users off-site', async ({ page }) => {
  await page.goto('/login?redirectTo=//evil.example/steal');
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
    'href',
    '/register?redirectTo=%2Fdashboard',
  );
});
