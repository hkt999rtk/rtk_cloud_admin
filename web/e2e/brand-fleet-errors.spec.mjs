import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertCustomerSafeError } from './fixtures/brand-fleet.mjs';

test.describe('Brandname source and error states', () => {
  test('[UI-CA-SOURCE-001] empty source renders an empty state @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'empty', 'run with E2E_SCENARIO_MODE=empty');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/sku-services');
    await expect(page.getByText('目前沒有 SKU')).toBeVisible();
  });

  test('[UI-CA-SOURCE-002] stale source keeps data and exposes freshness state @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'stale' && process.env.E2E_PROMETHEUS_MODE !== 'stale', 'run with E2E_PROMETHEUS_MODE=stale');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/overview');
    await expect(page.getByText(/stale|過期|舊資料|freshness/i).first()).toBeVisible();
  });

  test('[UI-CA-SOURCE-003] source mode renders unavailable instead of empty @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/jobs');
    await expect(page.getByText(/暫時無法取得|unavailable|無法取得/i).first()).toBeVisible();
    await expect(page.getByText('目前沒有批次工作。')).toHaveCount(0);
  });

  test('[UI-CA-SOURCE-004] customer-safe error does not expose upstream credentials @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/overview');
    await assertCustomerSafeError(page, /暫時|無法|unavailable/i);
    await expect(page.locator('body')).not.toContainText(/access_token|raw_payload|authorization|tenant_id/i);
  });
});
