import { expect, test } from '@playwright/test';

test('[UI-CA-AUTH-VIEW-001] dual-role account changes views and Brand Cloud without logging in again', async ({ page }) => {
  const loginRequests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname.startsWith('/api/auth/') && pathname.endsWith('/login')) {
      loginRequests.push(pathname);
    }
  });
  await page.goto('/login?next=%2Fadmin%3Ftab%3Dhealth%23status');
  await page.getByLabel('Email').fill('identity.dual@example.com');
  await page.getByLabel('Password').fill('e2e-identity-dual-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\?tab=health#status$/);
  await expect(page.getByRole('heading', { name: 'Platform Home', exact: true })).toBeVisible();
  const originalCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'rtk_admin_session');
  expect(originalCookie).toBeTruthy();

  await page.getByRole('button', { name: 'Brand Cloud view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Platform view', exact: true })).toBeVisible();
  await page.getByLabel('Active organization').selectOption('brand-e2e-02');
  await expect(page.getByLabel('Active organization')).toHaveValue('brand-e2e-02');
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).active_org_id).toBe('brand-e2e-02');

  await page.getByRole('button', { name: 'Platform view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Platform Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Brand Cloud view', exact: true }).click();
  await expect(page.getByLabel('Active organization')).toHaveValue('brand-e2e-02');

  const profile = await (await page.request.get('/api/me')).json();
  expect(profile.user_id).toBe('identity-dual-user');
  expect(profile.kind).toBe('customer');
  expect(profile.active_org_id).toBe('brand-e2e-02');
  expect((await page.context().cookies()).find((cookie) => cookie.name === 'rtk_admin_session')?.value).toBe(originalCookie.value);
  expect(loginRequests).toEqual(['/api/auth/login']);
});
