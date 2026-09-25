import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';
const burnerPath = '/console/chipset-sdk/pro2/firmware-burner';

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`[UI-CA-REFRESH-LAYOUT-001] merged developer tools use the shared design at ${width}px @smoke`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCSS('border-radius', '8px');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await testInfo.attach('social-login', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await login(page, 'developer');
    await page.goto(`/console/clouds/${cloud}/test-lab`);
    const panel = page.getByTestId('test-lab');
    await expect(panel).toBeVisible();
    const devices = panel.getByRole('tab', { name: 'Devices & credentials', exact: true });
    const runTests = panel.getByRole('tab', { name: 'Run tests', exact: true });
    await expect(devices).toHaveAttribute('aria-selected', 'true');
    await devices.focus();
    await page.keyboard.press('ArrowRight');
    await expect(runTests).toBeFocused();
    await expect(runTests).toHaveAttribute('aria-selected', 'true');
    await expect(runTests).toHaveCSS('color', 'rgb(3, 83, 144)');
    await expect(panel.getByRole('status')).toContainText('Choose and activate a test device');
    await expect(panel.getByRole('tab', { name: 'MQTT', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await testInfo.attach('test-lab', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.keyboard.press('Home');
    await expect(devices).toHaveAttribute('aria-selected', 'true');
    await page.goto(burnerPath);
    await expect(page.getByTestId('pro2-firmware-burner')).toBeVisible();
    await expect(page.locator('.enterprise-console')).toBeVisible();
    await expect(page.locator('#task-card')).toHaveCSS('border-top-color', 'rgb(0, 104, 183)');
    await expect(page.locator('#reset-device')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await testInfo.attach('pro2-burner', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

test('[UI-CA-REFRESH-SOCIAL-001] provider failure preserves the form and exact next destination @smoke', async ({ page }) => {
  const next = burnerPath + '?cloudId=' + cloud;
  let request;
  await page.route('**/api/auth/social/start', route => {
    request = route.request().postDataJSON();
    return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
  });
  await page.goto('/login?next=' + encodeURIComponent(next));
  await page.getByRole('button', { name: 'Continue with GitHub' }).click();
  await expect(page.getByRole('alert')).toContainText('GitHub sign-in is temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  expect(request).toEqual({ provider_id: 'github', next });
});

test('[UI-CA-REFRESH-SOCIAL-002] callback errors are announced and absent providers leave email sign-in available @smoke', async ({ page }) => {
  await page.route('**/api/auth/social/providers', route => route.fulfill({ json: { providers: [] } }));
  await page.goto('/login?social_error=invalid_state');
  await expect(page.getByRole('alert')).toContainText('This sign-in request expired.');
  await expect(page.locator('.social-login-stack')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});
