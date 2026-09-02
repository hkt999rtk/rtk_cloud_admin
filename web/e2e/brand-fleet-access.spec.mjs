import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';
const product = '55555555-5555-4555-8555-555555555555';

test.describe('Brandname capability matrix', () => {
  test('[UI-CA-ROLE-001] developer/release can read and manage release surfaces', async ({ page }) => {
    await login(page, 'developer');
    const me = await page.request.get('/api/me').then((response) => response.json());
    expect(me.capabilities).toContain('product.policy.manage');
    expect(me.capabilities).toContain('firmware.release.manage');
    expect(me.capabilities).toContain('ota.plan.manage');
    await page.goto(`/console/clouds/${cloud}/products`);
    await expect(page.getByRole('heading', { name: 'Products', exact: true }).first()).toBeVisible();
  });

  test('[UI-CA-ROLE-002] operations cannot write Product policy or release metadata', async ({ page }) => {
    await login(page, 'operations');
    const productWrite = await page.request.post(`/api/developer/brand-clouds/${cloud}/products`, { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-operations-product' }, data: { name: 'forbidden' } });
    expect(productWrite.status()).toBe(403);
    const releaseWrite = await page.request.post(`/api/developer/brand-clouds/${cloud}/products/${product}/releases`, { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-operations-release' }, data: { version: 'forbidden' } });
    expect(releaseWrite.status()).toBe(403);
  });

  test('[UI-CA-ROLE-003] observer is read-only through UI and direct API', async ({ page }) => {
    await login(page, 'observer');
    await page.goto(`/console/clouds/${cloud}/analytics`);
    await expect(page.getByText(/reports.create/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Report' })).toHaveCount(0);
    const write = await page.request.post(`/api/developer/brand-clouds/${cloud}/reports`, {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-observer-report' },
      data: { name: 'Forbidden report', report_type: 'fleet_status', dimensions: ['status'], timezone: 'UTC', format: 'json', scope: {} },
    });
    expect(write.status()).toBe(403);
  });
});
