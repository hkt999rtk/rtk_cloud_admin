import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';
import { assertForbiddenRoute } from './fixtures/brand-fleet.mjs';

test.describe('Brandname cloud scope', () => {
  test('[UI-CA-SCOPE-001] developer can switch Brand Clouds and keep URL/data scope aligned @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    await page.goto('/console/brand-e2e-01/overview');
    await expect(page.getByRole('heading', { name: '設備總覽' }).first()).toBeVisible();
    const selector = page.getByLabel('Active organization');
    await expect(selector).toHaveValue('brand-e2e-01');
    await expect(selector.locator('option[value="brand-e2e-02"]')).toHaveCount(1);
    const alphaDevices = await page.request.get('/api/fleet/devices?limit=100');
    expect(alphaDevices.ok()).toBeTruthy();
    const alpha = await alphaDevices.json();
    expect(alpha.devices.every((device) => device.organization_id === 'brand-e2e-01')).toBeTruthy();

    await selector.selectOption('brand-e2e-02');
    await expect(page).toHaveURL(/\/console\/brand-e2e-02\/overview$/);
    await expect(page.getByRole('heading', { name: '設備總覽' }).first()).toBeVisible();
    const betaDevices = await page.request.get('/api/fleet/devices?limit=100');
    expect(betaDevices.ok()).toBeTruthy();
    const beta = await betaDevices.json();
    expect(beta.devices.every((device) => device.organization_id === 'brand-e2e-02')).toBeTruthy();
    await expect(page.getByText('E2E Camera 001', { exact: true })).toHaveCount(0);
  });

  test('[UI-CA-SCOPE-002] non-member direct cloud link is forbidden without switching active cloud @brand-fleet', async ({ page }) => {
    await login(page, 'customer');
    await page.goto('/console/brand-e2e-02/overview');
    await assertForbiddenRoute(page);
    const response = await page.request.get('/api/fleet/devices?limit=100');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.devices.every((device) => device.organization_id === 'brand-e2e-01')).toBeTruthy();
  });
});
