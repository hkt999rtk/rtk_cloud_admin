import { expect, test } from '@playwright/test';

test('[UI-CA-AUTH-003] failed login renders its error once', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByText('Email or password is incorrect.')).toHaveCount(1);
});
