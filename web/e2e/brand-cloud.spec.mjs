import { test, expect } from '@playwright/test';
import { expectPageTitle, login } from './fixtures/session.mjs';

test.describe('Brand Clouds', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await login(page, 'platform_admin');
    await page.goto('/admin/brand-clouds');
    await expectPageTitle(page, 'Brand Clouds');
  });

  test('[UI-CA-CLOUD-001] list filters and detail reload show Account Manager data @smoke', async ({ page }) => {
    await expectPageTitle(page, 'Brand Clouds');
    await expect(page.getByText('E2E Alpha Cloud', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Brand Cloud detail' })).toBeVisible();
    await expect(page.getByText('SSO enabled', { exact: true })).toBeVisible();
    await expect(page.getByText('Global Users', { exact: true })).toBeVisible();
    await expect(page.getByText('trace-e2e-001', { exact: true })).toHaveCount(0);
  });

  test('[UI-CA-CLOUD-002] list status filter selects disabled Brand Clouds', async ({ page }) => {
    await page.getByLabel('Filter Brand Clouds status').selectOption('disabled');
    await expect(page.getByText('E2E Beta Cloud', { exact: true })).toBeVisible();
    await expect(page.getByText('E2E Alpha Cloud', { exact: true })).toHaveCount(0);
  });

  test('[UI-CA-CLOUD-003] list renders Account Manager upstream failures safely', async ({ page }) => {
    const mode = process.env.E2E_SCENARIO_MODE;
    test.skip(mode !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await expect(page.getByText(/Brand Clouds (?:unavailable|is temporarily unavailable)/i)).toBeVisible();
    await expect(page.getByText(/raw_payload|access_token|password|authorization/i)).toHaveCount(0);
  });

  test('[UI-CA-CLOUD-004] detail supports Brand Cloud and user lifecycle actions', async ({ page }) => {
    const betaRow = page.getByRole('row').filter({ hasText: 'E2E Beta Cloud' });
    await betaRow.getByRole('button', { name: 'View', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Brand Cloud detail' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Re-enable Brand Cloud' })).toBeVisible();
    const pendingUserRow = dialog.getByRole('row').filter({ hasText: 'user02-01@e2e.example' });
    await expect(pendingUserRow.getByText('Pending Activation', { exact: true })).toBeVisible();
    await pendingUserRow.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(dialog.getByText('Membership disabled.', { exact: true })).toBeVisible();
    await pendingUserRow.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(dialog.getByText('Membership enabled.', { exact: true })).toBeVisible();
    page.once('dialog', (confirmation) => confirmation.accept());
    await pendingUserRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog.getByText('Membership removed.', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Re-enable Brand Cloud' }).click();
    await expect(dialog.getByText('Brand Cloud enabled.', { exact: true })).toBeVisible();
    await dialog.getByLabel('Email').fill('new-admin@example.com');
    await dialog.getByRole('button', { name: 'Assign and Send Email' }).click();
    await expect(dialog.getByText('Global user created; activation email queued.', { exact: true })).toBeVisible();
  });

  test('[UI-CA-CLOUD-005] create stepper completes a Brand Cloud creation', async ({ page }) => {
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

  test('[UI-CA-CLOUD-006] create stepper surfaces partial owner assignment failure', async ({ page }) => {
    test.skip(process.env.E2E_FAIL_ACTION !== 'member-assign', 'run with E2E_FAIL_ACTION=member-assign');
    await page.getByRole('button', { name: 'Create Brand Cloud' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Brand Cloud' });
    await dialog.getByLabel('Brand display name').fill('E2E Partial Owner Cloud');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByLabel('Initial admin mode').selectOption('create');
    await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('partial-owner@example.com');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Create Brand Cloud', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Brand Cloud detail' })).toBeVisible();
    await expect(page.getByText(/Brand Cloud created, but initial admin setup needs attention/i)).toBeVisible();
    await expect(page.getByText(/temporarily unavailable|try again later/i)).toBeVisible();
  });
});
