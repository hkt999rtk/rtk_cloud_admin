import { test, expect } from '@playwright/test';
import { enterPlatform, login } from './fixtures/session.mjs';

test('platform admin can triage platform dashboard @smoke', async ({ page }) => {
  await login(page, 'platform_admin');
  await enterPlatform(page);
  await expect(page.getByText('Services Up', { exact: true })).toBeVisible();
  await expect(page.getByText('Service Health', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('K8s Workloads', { exact: true })).toBeVisible();
  await expect(page.getByText('Cluster Nodes', { exact: true })).toBeVisible();
  await expect(page.getByText('Operation Risk', { exact: true })).toBeVisible();
  await expect(page.getByText('Recent Incident Context', { exact: true })).toBeVisible();
  await expect(page.getByText(/Source: configured/i)).toBeVisible();
  await expect(page.getByText('E2E operation failed while calling upstream.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /View all operations/ })).toHaveAttribute('href', '/admin/ops');
});

test('dashboard shows degraded state when Prometheus fixture is unavailable', async ({ page }) => {
  test.skip(process.env.E2E_PROMETHEUS_MODE !== 'unavailable', 'run with E2E_PROMETHEUS_MODE=unavailable');
  await login(page, 'platform_admin');
  await enterPlatform(page);
  await expect(page.getByText(/Source: unavailable|Source: unconfigured/i)).toBeVisible();
  await expect(page.getByText('Healthy', { exact: true })).toHaveCount(0);
});
