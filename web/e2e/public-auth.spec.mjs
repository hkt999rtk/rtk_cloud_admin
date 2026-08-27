import { expect, test } from '@playwright/test';

test('[UI-CA-AUTH-001] reset password keeps the URL token out of the form @smoke', async ({ page }, testInfo) => {
  let resetPayload;
  await page.route('**/api/auth/reset-password', async (route) => {
    resetPayload = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });

  await page.goto('/reset-password?token=fixture-reset-token');

  await expect(page.getByLabel('Reset token')).toHaveCount(0);
  await expect(page.getByText('Reset token', { exact: true })).toHaveCount(0);
  await page.getByLabel('New password').fill('new-password-123');
  await page.getByRole('button', { name: 'Reset password' }).click();

  await expect(page.getByText('Password reset completed. You can sign in with the new password.')).toBeVisible();
  expect(resetPayload).toEqual({ token: 'fixture-reset-token', new_password: 'new-password-123' });
  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
