import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-ACCESS-001] anonymous cannot read platform admin API', async ({ page }) => {
  const response = await page.request.get('/api/admin/platform-dashboard');
  expect(response.status()).toBe(401);
  await page.goto('/');
});

test('[UI-CA-ACCESS-002] customer cannot read platform admin API', async ({ page }) => {
  await login(page, 'customer');
  const response = await page.request.get('/api/admin/platform-dashboard');
  expect(response.status()).toBe(403);
});

test('[UI-CA-ACCESS-003] customer view is separated from platform navigation', async ({ page }) => {
  await login(page, 'customer');
  await page.goto('/console');
  await expect(page.getByText('Connect+ Ops', { exact: true })).toBeVisible();
  await expect(page.getByText('Brand Cloud Management', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Platform Overview', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Switch to/i })).toHaveCount(0);

  await page.goto('/admin/health');
  await expect(page.getByRole('heading', { name: 'Platform access denied', exact: true })).toBeVisible();
});

test('[UI-CA-ACCESS-004] missing route capability stays on the access gate without protected API requests @smoke', async ({ page }) => {
  await login(page, 'customer');
  const protectedRequests = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/developer/brand-clouds' || path.startsWith('/api/billing/')) protectedRequests.push(path);
  });
  await page.route('**/api/developer/brand-clouds', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' }));

  await page.goto('/console/billing');

  await expect(page.getByRole('heading', { name: 'Brand Cloud capability required', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/console\/billing$/);
  await page.waitForTimeout(1_000);
  expect(protectedRequests).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Admin Console', exact: true })).toHaveCount(0);
});

test('[UI-CA-ACCESS-005] forbidden dashboard response does not redirect an authenticated session to login @smoke', async ({ page }) => {
  await login(page, 'customer');
  await page.route('**/api/summary', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' }));

  await page.goto('/console/overview');

  await expect(page.getByText('The requested data could not be loaded. Please try again.')).toBeVisible();
  await expect(page).toHaveURL(/\/console\/overview$/);
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('heading', { name: 'Admin Console', exact: true })).toHaveCount(0);
});
