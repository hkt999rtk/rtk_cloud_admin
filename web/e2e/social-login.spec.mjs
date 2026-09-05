import { expect, test } from '@playwright/test';

test('[UI-CA-AUTH-SOCIAL-001] @smoke configured social providers appear on sign in', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByText('or continue with email')).toBeVisible();

  await page.getByRole('tab', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0);
});

test('[UI-CA-AUTH-SOCIAL-002] @smoke platform entry uses the same provider choices', async ({ page }) => {
  await page.goto('/login?next=%2Fadmin');
  await expect(page.getByRole('heading', { name: 'Platform Admin sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
});
