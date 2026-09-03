import { test, expect } from '@playwright/test';
import { expectPageTitle, login } from './fixtures/session.mjs';
import { assertForbiddenRoute } from './fixtures/brand-fleet.mjs';

const cloudA = '33333333-3333-4333-8333-333333333333';
const cloudB = '44444444-4444-4444-8444-444444444444';

test.describe('Brandname cloud scope', () => {
  test('[UI-CA-SCOPE-001] developer can switch Brand Clouds and keep URL/data scope aligned @brand-fleet @smoke', async ({ page }) => {
    await login(page, 'developer');
    const activeOrgWrites = [];
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/me/active-org' && request.method() !== 'GET') activeOrgWrites.push(request.url()); });
    await page.goto(`/console/clouds/${cloudA}`);
    await expectPageTitle(page, 'Device Overview');
    const selector = page.getByLabel('Brand Cloud', { exact: true });
    await expect(selector).toHaveValue(cloudA);
    await expect(selector.locator(`option[value="${cloudB}"]`)).toHaveCount(1);
    const alphaDevices = await page.request.get(`/api/developer/brand-clouds/${cloudA}/fleet/devices?limit=100`);
    expect(alphaDevices.ok()).toBeTruthy();
    const alpha = await alphaDevices.json();
    expect(alpha.devices.every((device) => device.organization_id === cloudA)).toBeTruthy();

    await selector.selectOption(cloudB);
    await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudB}$`));
    await expectPageTitle(page, 'Device Overview');
    const betaDevices = await page.request.get(`/api/developer/brand-clouds/${cloudB}/fleet/devices?limit=100`);
    expect(betaDevices.ok()).toBeTruthy();
    const beta = await betaDevices.json();
    expect(beta.devices.every((device) => device.organization_id === cloudB)).toBeTruthy();
    await expect(page.getByText('E2E Camera 001', { exact: true })).toHaveCount(0);
    expect(activeOrgWrites).toEqual([]);
  });

  test('[UI-CA-SCOPE-002] non-member direct cloud link is forbidden without switching active cloud @brand-fleet', async ({ page }) => {
    await login(page, 'customer');
    await page.goto(`/console/clouds/${cloudB}`);
    await assertForbiddenRoute(page);
    const forbidden = await page.request.get(`/api/developer/brand-clouds/${cloudB}/fleet/devices?limit=100`);
    expect(forbidden.status()).toBe(403);
    const own = await page.request.get(`/api/developer/brand-clouds/${cloudA}/fleet/devices?limit=100`);
    expect(own.ok()).toBeTruthy();
    expect((await own.json()).devices.every((device) => device.organization_id === cloudA)).toBeTruthy();
  });
});
