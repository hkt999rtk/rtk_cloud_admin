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
