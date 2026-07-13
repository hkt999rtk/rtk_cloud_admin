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

  test('list renders Account Manager upstream failures safely', async ({ page }) => {
    const mode = process.env.E2E_SCENARIO_MODE;
    test.skip(mode !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await expect(page.getByText(/Brand Clouds (?:unavailable|is temporarily unavailable)/i)).toBeVisible();
    await expect(page.getByText(/raw_payload|access_token|password|authorization/i)).toHaveCount(0);
  });

  test('detail supports Brand Cloud and user lifecycle actions', async ({ page }) => {
    const betaRow = page.getByRole('row').filter({ hasText: 'E2E Beta Cloud' });
    await betaRow.getByRole('button', { name: 'View', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Brand Cloud detail' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Re-enable Brand Cloud' })).toBeVisible();
    await expect(dialog.getByText('Pending Activation', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(dialog.getByText('Brand user approved.', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Re-enable Brand Cloud' }).click();
    await expect(dialog.getByText('Brand Cloud enabled.', { exact: true })).toBeVisible();
    await dialog.getByLabel('Brand User id').fill('brand-user-beta-owner');
    await dialog.getByRole('button', { name: 'Assign Existing Brand User' }).click();
    await expect(dialog.getByText('Member assigned.', { exact: true })).toBeVisible();
    await dialog.getByLabel('Email').fill('new-admin@example.com');
    await dialog.getByLabel('Temporary password').fill('e2e-temporary-password');
    await dialog.getByRole('button', { name: 'Create Or Reactivate User' }).click();
    await expect(dialog.getByText('Brand user created and assigned.', { exact: true })).toBeVisible();
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

  test('create stepper surfaces partial owner assignment failure', async ({ page }) => {
    test.skip(process.env.E2E_FAIL_ACTION !== 'member-assign', 'run with E2E_FAIL_ACTION=member-assign');
    await page.getByRole('button', { name: 'Create Brand Cloud' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Brand Cloud' });
    await dialog.getByLabel('Brand display name').fill('E2E Partial Owner Cloud');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByLabel('Initial admin mode').selectOption('existing');
    await dialog.getByRole('textbox', { name: 'Brand User id' }).fill('brand-user-alpha-owner');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Create Brand Cloud', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Brand Cloud detail' })).toBeVisible();
    await expect(page.getByText(/Brand Cloud created, but initial admin setup needs attention/i)).toBeVisible();
    await expect(page.getByText(/temporarily unavailable|try again later/i)).toBeVisible();
  });
});
