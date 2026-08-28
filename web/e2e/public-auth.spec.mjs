import { expect, test } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-AUTH-001] reset password keeps the URL token out of the form @smoke', async ({ page }, testInfo) => {
  let resetPayload;
  await page.route('**/api/auth/reset-password', async (route) => {
    resetPayload = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });

  await page.goto('/reset-password?token=fixture-reset-token');

  await expect(page.getByLabel('Reset token')).toHaveCount(0);
  await expect(page.getByText('Reset token', { exact: true })).toHaveCount(0);
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page.getByText('Password updated', { exact: true })).toBeVisible();
  expect(resetPayload).toEqual({ token: 'fixture-reset-token', new_password: 'new-password-123' });
  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-AUTH-002] checkbox follows the shared console control style @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/reports');

  const checkbox = page.getByRole('checkbox', { name: 'product' });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveCSS('appearance', 'none');
  await expect(checkbox).toHaveCSS('width', '18px');
  await expect(checkbox).toHaveCSS('height', '18px');
  await expect(checkbox).toHaveCSS('min-width', '18px');
  await expect(checkbox).toHaveCSS('border-radius', '5px');

  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveCSS('background-color', 'rgb(0, 104, 183)');

  await testInfo.attach('checkbox-control', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
