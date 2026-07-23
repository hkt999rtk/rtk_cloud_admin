import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test.describe('Brandname capability matrix', () => {
  test('[UI-CA-ROLE-001] developer/release can read and manage release surfaces', async ({ page }) => {
    await login(page, 'developer');
    const me = await page.request.get('/api/me').then((response) => response.json());
    expect(me.capabilities).toContain('sku.policy.manage');
    expect(me.capabilities).toContain('firmware.release.manage');
    expect(me.capabilities).toContain('ota.plan.manage');
    await page.goto('/console/brand-e2e-01/sku-services');
    await expect(page.getByRole('heading', { name: 'SKU 與服務' }).first()).toBeVisible();
  });

  test('[UI-CA-ROLE-002] operations cannot write SKU policy or release metadata', async ({ page }) => {
    await login(page, 'operations');
    const skuWrite = await page.request.post('/api/skus', { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-operations-sku' }, data: { name: 'forbidden' } });
    expect(skuWrite.status()).toBe(403);
    const releaseWrite = await page.request.post('/api/skus/sku-alpha/releases', { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-operations-release' }, data: { version: 'forbidden' } });
    expect(releaseWrite.status()).toBe(403);
  });

  test('[UI-CA-ROLE-003] observer is read-only through UI and direct API', async ({ page }) => {
    await login(page, 'observer');
    await page.goto('/console/brand-e2e-01/reports');
    await expect(page.getByText(/reports.create/)).toBeVisible();
    await expect(page.getByRole('button', { name: '建立報表' })).toHaveCount(0);
    const write = await page.request.post('/api/provisioning/validate', { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-observer-provisioning' }, data: { sku_id: 'sku-alpha', device_ids: ['dev-e2e-001'] } });
    expect(write.status()).toBe(403);
  });
});
