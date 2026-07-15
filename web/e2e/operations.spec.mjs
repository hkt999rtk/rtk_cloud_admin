import { test, expect } from '@playwright/test';
import { enterPlatform, login } from './fixtures/session.mjs';

test('platform admin can open operations and service logs', async ({ page }) => {
  await login(page, 'platform_admin');
  await enterPlatform(page);
  await page.getByRole('button', { name: 'Operations Log', exact: true }).click();
  await expect(page.getByText('Lifecycle operations', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search operations' }).fill('E2E upstream rejected');
  await expect(page.getByText('E2E upstream rejected request.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Service Logs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service Logs', exact: true })).toBeVisible();
  await expect(page.getByText('E2E operation failed while calling upstream.', { exact: true })).toBeVisible();
  await expect(page.getByText('trace-e2e-001', { exact: true })).toBeVisible();
});
