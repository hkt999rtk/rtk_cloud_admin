import { expect } from '@playwright/test';

export async function login(page, kind) {
  const endpoint = kind.startsWith('platform_') ? '/api/auth/platform/login' : '/api/auth/customer/login';
  const customerIdentity = {
    customer: ['customer@example.com', 'e2e-customer-password'],
    developer: ['developer@example.com', 'e2e-developer-password'],
    operations: ['operations@example.com', 'e2e-operations-password'],
    observer: ['observer@example.com', 'e2e-observer-password'],
    outsider: ['outsider@example.com', 'e2e-outsider-password'],
  };
  const platformIdentity = {
    platform_admin: ['platform.admin@example.com', 'e2e-platform-password'],
    platform_reader: ['platform.reader@example.com', 'e2e-platform-reader-password'],
  };
  const [email, password] = platformIdentity[kind] || customerIdentity[kind] || customerIdentity.customer;
  const response = await page.request.post(endpoint, { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}

export async function enterCustomer(page, cloudId = 'brand-e2e-01') {
  await page.goto(`/console/${encodeURIComponent(cloudId)}/overview`);
  await expect(page.getByText('Brand Fleet', { exact: true })).toBeVisible();
}

export async function waitForJobState(page, jobId, states = ['completed'], timeout = 15_000) {
  const pattern = new RegExp(`^(?:${states.join('|')})$`);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok()) return 'unavailable';
    const body = await response.json();
    return body.job?.state || 'unknown';
  }, { timeout }).toMatch(pattern);
}

export async function loginWithStagingSession(page, kind = 'platform') {
  const value = kind === 'customer' ? process.env.E2E_CUSTOMER_SESSION_ID : process.env.E2E_PLATFORM_SESSION_ID;
  expect(value, `E2E_${kind.toUpperCase()}_SESSION_ID is required`).toBeTruthy();
  await page.context().addCookies([{ name: 'rtk_admin_session', value, url: process.env.E2E_BASE_URL }]);
}

export async function enterPlatform(page) {
  await page.goto('/admin');
  const switchButton = page.getByRole('button', { name: 'Switch to Platform View' });
  try {
    await switchButton.waitFor({ state: 'visible', timeout: 10_000 });
    await switchButton.click();
    await page.getByRole('heading', { name: 'Platform Dashboard' }).waitFor();
  } catch {
    await page.getByRole('heading', { name: 'Platform Dashboard' }).waitFor();
  }
}
