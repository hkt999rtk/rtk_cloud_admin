import { test, expect } from '@playwright/test';
import { enterPlatform, login } from './fixtures/session.mjs';

test('platform admin can review local audit records after a Brand Cloud action', async ({ page }) => {
  await login(page, 'platform_admin');
  await enterPlatform(page);
  await page.getByRole('button', { name: 'Brand Clouds', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Brand Clouds' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create Brand Cloud', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Brand Cloud' });
  await dialog.getByLabel('Brand display name').fill('E2E Audit Cloud');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Create Brand Cloud', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Brand Cloud detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit Log', exact: true })).toBeVisible();
  await expect(page.getByText('Current write coverage', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'platform.brand_cloud.create', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'platform.admin@example.com', exact: true }).first()).toBeVisible();
});
