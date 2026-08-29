import { test, expect } from '@playwright/test';
import { loginWithStagingSession } from './fixtures/session.mjs';

test('[UI-CA-STAGING-002] Brandname staging read-only smoke @staging @brand-fleet', async ({ page }) => {
  const cloudId = process.env.E2E_BRAND_CLOUD_ID;
  test.skip(!cloudId, 'E2E_BRAND_CLOUD_ID is required');
  await loginWithStagingSession(page, 'customer');
  for (const [path, heading] of [
    [`/console/${cloudId}/overview`, 'Device Overview'],
    [`/console/${cloudId}/devices`, 'Devices'],
    [`/console/${cloudId}/product-services`, 'Products and Services'],
    [`/console/${cloudId}/firmware-ota`, 'Firmware Update'],
    [`/console/${cloudId}/reports`, 'Reports'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});
