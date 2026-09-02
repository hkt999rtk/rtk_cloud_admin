import { expect, test } from '@playwright/test';
import { login } from './fixtures/session.mjs';

test('[UI-CA-AUTH-LOGIN-001] shared login branding follows the selected auth mode @smoke', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Sign in to Connect+', exact: true })).toBeVisible();
  await expect(page.getByText('Use your Connect+ account to continue.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sign in', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Sign in Connect+');

  await page.getByRole('tab', { name: 'Create account', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Create your Connect+ account', exact: true })).toBeVisible();
  await expect(page.getByText('Create an account to get started with Connect+.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Create account Connect+');
});

test('[UI-CA-AUTH-LOGIN-002] admin destinations use the platform sign-in context @smoke', async ({ page }) => {
  await page.goto('/login?next=%2Fadmin%2Fhealth');

  await expect(page.getByRole('heading', { name: 'Platform Admin sign in', exact: true })).toBeVisible();
  await expect(page.getByText('Sign in with your platform administrator account.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Auth mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Platform Admin sign in Connect+');
});

for (const [name, next] of [
  ['customer', '/console/clouds'],
  ['unrelated', '/administrator'],
  ['external', 'https://evil.example/admin'],
]) {
  test(`[UI-CA-AUTH-LOGIN-003] ${name} destinations keep the shared sign-in context`, async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);

    await expect(page.getByRole('heading', { name: 'Sign in to Connect+', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Create account', exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Sign in Connect+');
  });
}

test('[UI-CA-AUTH-001] reset password keeps the URL token out of the form @smoke', async ({ page }, testInfo) => {
  let resetPayload;
  await page.route('**/api/auth/reset-password', async (route) => {
    resetPayload = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });

  await page.goto('/reset-password?token=fixture-reset-token');

  await expect(page.getByLabel('Reset token')).toHaveCount(0);
  await expect(page.getByText('Reset token', { exact: true })).toHaveCount(0);
  await page.getByLabel('New password', { exact: true }).fill('new-password-123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-password-123');
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page.getByText('Password updated', { exact: true })).toBeVisible();
  expect(resetPayload).toEqual({ token: 'fixture-reset-token', new_password: 'new-password-123' });
  await testInfo.attach('final-viewport', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-AUTH-002] checkbox follows the shared console control style @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto('/console/clouds/33333333-3333-4333-8333-333333333333/analytics');

  const checkbox = page.getByRole('checkbox', { name: 'product' });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveCSS('appearance', 'none');
  await expect(checkbox).toHaveCSS('width', '18px');
  await expect(checkbox).toHaveCSS('height', '18px');
  await expect(checkbox).toHaveCSS('min-width', '18px');
  await expect(checkbox).toHaveCSS('border-radius', '5px');

  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveCSS('background-color', 'rgb(0, 104, 183)');

  await testInfo.attach('checkbox-control', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('[UI-CA-AUTH-LOGOUT-001] logout remains reachable on desktop and mobile @smoke', async ({ page }, testInfo) => {
  await login(page, 'customer');
  await page.goto('/console/clouds');
  const navigationButton = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await navigationButton.isVisible()) {
    await navigationButton.click();
    await page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Logout', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Sign in to Connect+', exact: true })).toBeVisible();
  const response = await page.request.get('/api/me');
  expect((await response.json()).authenticated).toBe(false);
  await testInfo.attach('logged-out-viewport', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

for (const [kind, destination] of [['customer', '/console/clouds'], ['platform_admin', '/admin']]) {
  test(`[UI-CA-AUTH-ACTIVATE-001] email activation enters the ${kind} account view @smoke`, async ({ page }, testInfo) => {
    let verificationCount = 0;
    await page.route('**/api/auth/customer/verification-status', (route) => route.fulfill({ json: { status: 'valid' } }));
    await page.route('**/api/auth/customer/verify-email', async (route) => {
      verificationCount += 1;
      expect(route.request().postDataJSON()).toEqual({ token: 'fixture-activation-token', new_password: 'activation-password-123' });
      // Establish a fixture account session; the handler itself is covered by Go tests.
      await login(page, kind);
      await route.fulfill({ json: { kind, tokens: { access_token: 'fixture-activation-access' } } });
    });
    await page.goto('/signup/verify?token=fixture-activation-token');
    await page.getByLabel('New password', { exact: true }).fill('activation-password-123');
    await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(page.getByRole('heading', { name: kind === 'customer' ? 'My Clouds' : 'Platform Home', exact: true }).first()).toBeVisible();
    expect(verificationCount).toBe(1);
    await testInfo.attach('activated-account-view', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}
