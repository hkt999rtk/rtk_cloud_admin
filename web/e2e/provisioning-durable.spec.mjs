import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';
const product = '44444444-4444-4444-8444-444444444444';
const apiRoot = `/api/developer/brand-clouds/${cloud}`;

function me(capabilities) {
  return {
    user_id: 'developer-user', email: 'developer@example.com', name: 'Developer', kind: 'customer',
    memberships: [{ organization_id: cloud, organization: 'P0 Camera Cloud', role: 'owner', capabilities }],
    active_org_id: cloud, authenticated: true, upstream_account_manager: true, capabilities,
  };
}

function job(id, state, allowedActions, extra = {}) {
  return {
    id, type: id.startsWith('execute') ? 'device_provision' : 'provisioning_validation',
    organization_id: cloud, state, total: 2, completed: state === 'completed' ? 2 : 1,
    failed: state === 'partial_failed' ? 1 : 0, skipped: state === 'cancelled' ? 1 : 0,
    allowed_actions: allowedActions, state_version: 2, authorization_status: state === 'cancelled' || state === 'completed' ? 'revoked' : 'active',
    scope: { product_id: product, validation: { valid: state === 'completed' } }, ...extra,
  };
}

async function installProvisioningRoutes(page, capabilities) {
  let currentItems = [];
  await page.route('**/api/me', (route) => route.fulfill({ json: me(capabilities) }));
  await page.route('**/api/developer/brand-clouds', (route) => route.fulfill({ json: { brand_clouds: [{ id: cloud, name: 'P0 Camera Cloud', capabilities }] } }));
  await page.route('**/api/developer/brand-clouds/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === apiRoot) return route.fulfill({ json: { brand_cloud: { id: cloud, name: 'P0 Camera Cloud', capabilities } } });
    if (path === `${apiRoot}/fleet/summary`) return route.fulfill({ json: { total: 2, by_status: { online: 2 }, source_status: 'available' } });
    if (path === `${apiRoot}/fleet/devices`) return route.fulfill({ json: { devices: [], pagination: { total: 0, limit: 100, offset: 0 }, source_status: 'available' } });
    if (path === `${apiRoot}/products`) return route.fulfill({ json: { products: [{ id: product, name: 'E2E Camera' }], pagination: { total: 1 } } });
    if (path === `${apiRoot}/provisioning/sources` && request.method() === 'POST') {
      return route.fulfill({ status: 201, json: { source: { id: 'source-p0', filename: 'devices.csv', row_count: 2, checksum: `sha256:${'a'.repeat(64)}`, expires_at: '2026-09-10T00:00:00Z' } } });
    }
    if (path === `${apiRoot}/provisioning/validate` && request.method() === 'POST') {
      currentItems = [{ item_key: 'device-1', state: 'running', attempt: 1, retryable: false }];
      return route.fulfill({ status: 202, json: { job: job('validate-p0', 'running', ['pause', 'cancel']) } });
    }
    if (path.endsWith('/validate-p0/pause')) return route.fulfill({ status: 202, json: { job: job('validate-p0', 'paused', ['resume', 'cancel']) } });
    if (path.endsWith('/validate-p0/resume')) {
      currentItems = [{ item_key: 'device-1', state: 'validated', attempt: 1, retryable: false }, { item_key: 'device-2', state: 'failed', attempt: 1, failure_code: 'UPSTREAM_TRANSIENT', retryable: true }];
      return route.fulfill({ status: 202, json: { job: job('validate-p0', 'partial_failed', ['retry']) } });
    }
    if (path.endsWith('/validate-p0/retry')) {
      currentItems = [{ item_key: 'device-1', state: 'validated', attempt: 1, retryable: false }, { item_key: 'device-2', state: 'validated', attempt: 2, retryable: false }];
      return route.fulfill({ status: 202, json: { job: job('validate-retry-p0', 'completed', []) } });
    }
    if (path === `${apiRoot}/provisioning/jobs` && request.method() === 'POST') {
      currentItems = [{ item_key: 'device-1', state: 'completed', attempt: 1, retryable: false }, { item_key: 'device-2', state: 'running', attempt: 1, retryable: false }];
      return route.fulfill({ status: 202, json: { job: job('execute-p0', 'running', ['pause', 'cancel']) } });
    }
    if (path.endsWith('/execute-p0/cancel')) {
      currentItems = [{ item_key: 'device-1', state: 'completed', attempt: 1, retryable: false }, { item_key: 'device-2', state: 'skipped', attempt: 0, failure_code: 'USER_CANCELLED', retryable: false }];
      return route.fulfill({ status: 202, json: { job: job('execute-p0', 'cancelled', []) } });
    }
    if (path.endsWith('/items')) {
      const url = new URL(request.url());
      const items = currentItems.filter((item) => (!url.searchParams.has('state') || item.state === url.searchParams.get('state')) && (!url.searchParams.has('retryable') || item.retryable));
      return route.fulfill({ json: { items, pagination: { total: items.length, limit: 100, offset: 0 }, source_status: 'available' } });
    }
    if (path.includes('/jobs/')) return route.fulfill({ json: { job: job('validate-retry-p0', 'completed', []) } });
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
  });
}

test('[UI-CA-PROV-P0-001] durable provisioning actions and row results follow server state @smoke', async ({ page }) => {
  await login(page, 'developer');
  await installProvisioningRoutes(page, ['product.read', 'provisioning.read', 'provisioning.create']);
  await page.goto(`/console/clouds/${cloud}/fleet/provisioning`);
  await expect(page.getByRole('heading', { name: 'CSV Provisioning', level: 2 })).toBeVisible();
  await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption(product);
  await page.locator('input[type=file]').setInputFiles({ name: 'devices.csv', mimeType: 'text/csv', buffer: Buffer.from('device_id\ndevice-1\ndevice-2\n') });
  await page.getByRole('button', { name: 'Upload source' }).click();
  await page.getByRole('button', { name: 'Validate rows' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText(/partial_failed/)).toBeVisible();
  await page.getByRole('button', { name: 'Retryable rows' }).click();
  await expect(page.getByText('UPSTREAM_TRANSIENT')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm provisioning' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm provisioning' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/cancelled/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download CSV result' })).toBeVisible();
});

test('[UI-CA-PROV-P0-002] provisioning writes stay hidden without capability @smoke', async ({ page }) => {
  await login(page, 'observer');
  await installProvisioningRoutes(page, ['product.read', 'provisioning.read']);
  await page.goto(`/console/clouds/${cloud}/fleet/provisioning`);
  await expect(page.getByRole('heading', { name: 'Read-only access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload source' })).toHaveCount(0);
});
