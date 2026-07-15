import { expect } from '@playwright/test';

export async function login(page, kind) {
  const endpoint = kind === 'platform_admin' ? '/api/auth/platform/login' : '/api/auth/customer/login';
  const response = await page.request.post(endpoint, { data: { email: kind === 'platform_admin' ? 'platform.admin@example.com' : 'customer@example.com', password: kind === 'platform_admin' ? 'e2e-platform-password' : 'e2e-customer-password' } });
  expect(response.ok()).toBeTruthy();
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
