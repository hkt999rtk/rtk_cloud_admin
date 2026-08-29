import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertCustomerSafeError } from './fixtures/brand-fleet.mjs';

test.describe('Brandname source and error states', () => {
  test('[UI-CA-SOURCE-001] empty source renders an empty state @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'empty', 'run with E2E_SCENARIO_MODE=empty');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/product-services');
    await expect(page.getByRole('heading', { name: 'No Products yet' })).toBeVisible();
  });

  test('[UI-CA-SOURCE-002] stale source keeps data and exposes freshness state @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'stale' && process.env.E2E_PROMETHEUS_MODE !== 'stale', 'run with E2E_PROMETHEUS_MODE=stale');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/overview');
    await expect(page.getByText(/stale|Expires|Old data|freshness/i).first()).toBeVisible();
  });

  test('[UI-CA-SOURCE-003] source mode renders unavailable instead of empty @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await login(page, 'developer');
    const shellResponses = new Map([
      ['/api/summary', {}], ['/api/customers', []], ['/api/fleet/devices', { devices: [] }],
      ['/api/fleet/summary', {}], ['/api/products', { products: [], source_status: 'unavailable', source_message: 'Product Data is temporarily unavailable.' }],
    ]);
    await page.route('**/api/**', (route) => {
      const response = shellResponses.get(new URL(route.request().url()).pathname);
      return response === undefined
        ? route.continue()
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto('/console/brand-e2e-01/product-services');
    await expect(page.getByText(/Temporarily unavailable|unavailable|Unavailable|not configured/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No Products yet' })).toHaveCount(0);
  });

  test('[UI-CA-SOURCE-004] customer-safe error does not expose upstream credentials @brand-fleet @errors', async ({ page }) => {
    test.skip(process.env.E2E_SCENARIO_MODE !== 'unavailable', 'run with E2E_SCENARIO_MODE=unavailable');
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/overview');
    await assertCustomerSafeError(page, /Temporary|Unable to|unavailable/i);
    await expect(page.locator('body')).not.toContainText(/access_token|raw_payload|authorization|tenant_id/i);
  });
});
