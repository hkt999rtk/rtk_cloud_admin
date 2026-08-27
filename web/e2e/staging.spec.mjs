import { test, expect } from '@playwright/test';
import { loginWithStagingSession } from './fixtures/session.mjs';

test('[UI-CA-STAGING-001] staging platform admin can read operations @staging', async ({ page }) => {
  test.skip(!process.env.E2E_BASE_URL, 'staging base URL is required');
  await loginWithStagingSession(page);
  await page.goto('/admin/ops');
  await expect(page.getByRole('heading', { name: '營運紀錄', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '平台首頁', exact: true })).toBeVisible();
});
