import { test, expect } from '@playwright/test';

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`[UI-CA-SERVICELOGIN-LAYOUT-001] branded sign-in and signup reflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to Connect+', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Realtek', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCSS('background-color', 'rgb(0, 104, 183)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your Connect+ account' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`signup-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('[UI-CA-SERVICELOGIN-PASSWORD-001] password toggle preserves value and never submits @smoke', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.method() === 'POST') requests.push(request.url()); });
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'username');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await password.fill('local-test-value');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('local-test-value');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  expect(requests).toEqual([]);
});

test('[UI-CA-SERVICELOGIN-ERROR-001] sign-in failure stays visible without leaving the form @smoke', async ({ page }, testInfo) => {
  await page.route('**/api/auth/login', route => route.fulfill({ status: 401, json: { message: 'Invalid email or password.' } }));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Password', { exact: true }).fill('invalid-fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/login$/);
  await page.screenshot({ path: testInfo.outputPath('login-error.png'), fullPage: true });
});
