import { test, expect } from '@playwright/test';
import { enterPlatform, login } from './fixtures/session.mjs';

test.describe('Brand Clouds', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'platform_admin');
    await enterPlatform(page);
    await page.getByRole('button', { name: 'Brand Clouds', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Brand Clouds' }).first()).toBeVisible();
  });

  test('list filters and detail reload show Account Manager data @smoke', async ({ page }) => {
    await expect(page.getByText('Brand Clouds', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('E2E Alpha Cloud', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Brand Cloud detail' })).toBeVisible();
    await expect(page.getByText('SSO enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('Brand Users', { exact: true })).toBeVisible();
    await expect(page.getByText('trace-e2e-001', { exact: true })).toHaveCount(0);
  });

  test('list status filter selects disabled Brand Clouds', async ({ page }) => {
    await page.getByLabel('Filter Brand Clouds status').selectOption('disabled');
    await expect(page.getByText('E2E Beta Cloud', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E Alpha Cloud', { exact: true })).toHaveCount(0);
  });

  test('create stepper completes a Brand Cloud creation', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Brand Cloud' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Brand Cloud' });
    await dialog.getByLabel('Brand display name').fill('E2E Created From Browser');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('Review', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Create Brand Cloud' }).click();
    await expect(page.getByRole('dialog', { name: 'Brand Cloud detail' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E Created From Browser' })).toBeVisible();
  });
});
