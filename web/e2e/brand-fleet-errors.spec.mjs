import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertCustomerSafeError } from './fixtures/brand-fleet.mjs';

const cloudId = '33333333-3333-4333-8333-333333333333';
const cloudRoot = `/api/developer/brand-clouds/${cloudId}`;

test.describe('Brandname source and error states', () => {
  test('[UI-CA-SOURCE-001] empty source renders an empty state @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'empty', 'run with E2E_SCENARIO_MODE=empty');
    await login(page, 'developer');
    await page.goto(`/console/clouds/${cloudId}/products`);
    await expect(page.getByText('No Products in your authorized scope.', { exact: true })).toBeVisible();
  });

  test('[UI-CA-SOURCE-002] stale source keeps data and exposes freshness state @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'stale' && process.env.E2E_PROMETHEUS_MODE !== 'stale', 'run with E2E_PROMETHEUS_MODE=stale');
    await login(page, 'developer');
    await page.goto(`/console/clouds/${cloudId}`);
    await expect(page.getByText(/stale|Expires|Old data|freshness/i).first()).toBeVisible();
  });

  test('[UI-CA-SOURCE-003] source mode renders unavailable instead of empty @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await login(page, 'developer');
    const shellResponses = new Map([[cloudRoot, { brand_cloud: {
      id: cloudId,
      name: 'E2E Alpha Cloud',
      owner_user_id: 'developer-user',
      my_role: 'owner',
      capabilities: ['product.read', 'product.manage'],
    } }]]);
    await page.route('**/api/**', (route) => {
      const response = shellResponses.get(new URL(route.request().url()).pathname);
      return response === undefined
        ? route.continue()
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto(`/console/clouds/${cloudId}/products`);
    await expect(page.getByText(/Temporarily unavailable|unavailable|Unavailable|not configured/i).first()).toBeVisible();
    await expect(page.getByText('No Products in your authorized scope.', { exact: true })).toHaveCount(0);
  });

  test('[UI-CA-SOURCE-004] customer-safe error does not expose upstream credentials @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await login(page, 'developer');
    await page.goto(`/console/clouds/${cloudId}`);
    await assertCustomerSafeError(page, /requested data|Temporary|Unable to|unavailable/i);
    await expect(page.locator('body')).not.toContainText(/access_token|raw_payload|authorization|tenant_id/i);
  });
});
