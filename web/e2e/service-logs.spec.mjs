import { test, expect } from '@playwright/test';
import { enterPlatform, login } from './fixtures/session.mjs';

test('platform admin can inspect recent service-log incident context', async ({ page }) => {
  await login(page, 'platform_admin');
  await enterPlatform(page);
  await page.goto('/admin/logs');
  await expect(page.getByRole('heading', { name: 'Service Logs', exact: true })).toBeVisible();
  await expect(page.getByText('E2E operation failed while calling upstream.', { exact: true })).toBeVisible();
  await expect(page.getByText('trace-e2e-001', { exact: true })).toBeVisible();
  await expect(page.getByText('request-e2e-001', { exact: true })).toBeVisible();
  await expect(page.getByText(/raw_payload|access_token|password/i)).toHaveCount(0);
});
