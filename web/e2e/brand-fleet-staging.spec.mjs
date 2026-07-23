import { test, expect } from '@playwright/test';
import { loginWithStagingSession } from './fixtures/session.mjs';

test('[UI-CA-STAGING-002] Brandname staging read-only smoke @staging @brand-fleet', async ({ page }) => {
  const cloudId = process.env.E2E_BRAND_CLOUD_ID;
  test.skip(!cloudId, 'E2E_BRAND_CLOUD_ID is required');
  await loginWithStagingSession(page, 'customer');
  for (const [path, heading] of [
    [`/console/${cloudId}/overview`, '設備總覽'],
    [`/console/${cloudId}/devices`, '設備'],
    [`/console/${cloudId}/sku-services`, 'SKU 與服務'],
    [`/console/${cloudId}/firmware-ota`, '韌體更新'],
    [`/console/${cloudId}/jobs`, '批次工作'],
    [`/console/${cloudId}/reports`, '報表'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});
