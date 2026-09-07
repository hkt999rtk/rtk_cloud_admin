import { expect, test } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const cloudA = '11111111-1111-4111-8111-111111111111';
const cloudB = '22222222-2222-4222-8222-222222222222';
const guideTitle = 'A cloud brings your products and devices together.';
const drawerTitle = 'Clouds, products & devices';

test('[UI-CA-CLOUD-GUIDE-006] Members shows architecture and owner sharing guidance without granting access @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  const accessWrites = [];
  page.on('request', request => {
    if (request.url().includes('/members') && request.method() !== 'GET') accessWrites.push(request.url());
  });
  await page.goto(`/console/clouds/${cloudA}/members`);
  await expectGuide(page);
  const sharing = page.getByRole('region', { name: 'Cloud sharing' });
  await expect(sharing.getByRole('heading', { name: 'Members and sharing', exact: true })).toBeVisible();
  await expect(sharing.getByText(/Collaborate on your cloud using individual developer accounts/)).toBeVisible();
  await expect(sharing.getByText(/Members are developers and operators/)).toBeVisible();
  await expect(sharing.locator('.cloud-sharing-guide li')).toHaveCount(3);
  await expect(sharing.getByText(/Only the cloud owner can invite members or change access/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('members-guidance.png'), fullPage: true });
  await sharing.getByRole('button', { name: 'Share cloud', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite verified developer' });
  await expect(dialog.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('viewer');
  await expect(dialog.getByRole('combobox', { name: 'Access scope' })).toHaveValue('selected_products');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  expect(accessWrites).toEqual([]);
});

test('[UI-CA-CLOUD-GUIDE-007] Collaborators see the guides without owner sharing controls @smoke', async ({ page }) => {
  await login(page, 'billing_viewer');
  await page.goto(`/console/clouds/${cloudA}/members`);
  await expectGuide(page);
  await expect(page.locator('.cloud-sharing-guide')).toBeVisible();
  await expect(page.getByText(/If you are a collaborator, ask the owner/)).toBeVisible();
  for (const name of ['Share cloud', 'Change access', 'Remove access', 'Send invitation']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
});

test('[UI-CA-CLOUD-GUIDE-004] Developer overview links retain the selected cloud @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  await page.goto(`/console/clouds/${cloudA}`);
  const intro = page.locator('.overview-concept-intro');
  await expect(intro.getByRole('heading', { name: 'Cloud Overview', exact: true })).toBeVisible();
  await expect(intro.getByText('DEVELOPER CONSOLE', { exact: true })).toBeVisible();
  await expect(intro.getByText('See device connectivity, activity and health across your cloud.', { exact: true })).toBeVisible();
  await expect(intro.locator('.overview-next-steps')).toHaveText('Manage product settings in Products, test device interactions in Cloud Test Lab, and investigate individual devices in Fleet Management.');
  await page.getByLabel('Brand Cloud', { exact: true }).selectOption(cloudB);
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudB}$`));
  for (const [label, segment] of [['Products', 'products'], ['Cloud Test Lab', 'test-lab'], ['Fleet Management', 'fleet']]) {
    const link = intro.getByRole('link', { name: label, exact: true });
    const destination = `/console/clouds/${cloudB}/${segment}`;
    await expect(link).toHaveAttribute('href', destination);
    await expect(page.locator('.sidebar').getByRole('link', { name: label, exact: true })).toHaveAttribute('href', destination);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await page.goBack();
    await expect(intro).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('developer-overview.png'), fullPage: true });
});

test('[UI-CA-CLOUD-GUIDE-005] Developer guidance matches navigation permissions and keeps complete sentences @smoke', async ({ page }) => {
  await login(page, 'billing_owner');
  let capabilities = [];
  await page.route(`**/api/developer/brand-clouds/${cloudA}`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.brand_cloud.capabilities = capabilities;
    await route.fulfill({ response, json: body });
  });
  const cases = [
    { capabilities: ['registry_device.read'], labels: ['Products'], sentence: 'Manage product settings in Products.' },
    { capabilities: ['product.read'], labels: ['Products', 'Cloud Test Lab'], sentence: 'Manage product settings in Products and test device interactions in Cloud Test Lab.' },
    { capabilities: ['customer.devices.read'], labels: ['Fleet Management'], sentence: 'Investigate individual devices in Fleet Management.' },
    { capabilities: [], labels: [], sentence: '' },
  ];
  for (const scenario of cases) {
    capabilities = scenario.capabilities;
    await page.goto(`/console/clouds/${cloudA}`);
    const intro = page.locator('.overview-concept-intro');
    await expect(intro.getByRole('heading', { name: 'Cloud Overview', exact: true })).toBeVisible();
    for (const label of ['Products', 'Cloud Test Lab', 'Fleet Management']) {
      const count = scenario.labels.includes(label) ? 1 : 0;
      await expect(intro.getByRole('link', { name: label, exact: true })).toHaveCount(count);
      await expect(page.locator('.sidebar').getByRole('link', { name: label, exact: true })).toHaveCount(count);
    }
    if (scenario.sentence) await expect(intro.locator('.overview-next-steps')).toHaveText(scenario.sentence);
    else await expect(intro.locator('.overview-next-steps')).toHaveCount(0);
    await expect(intro.getByRole('button', { name: 'Cloud concepts', exact: true })).toBeVisible();
  }
});

async function expectGuide(page) {
  const guide = page.getByRole('region', { name: guideTitle });
  await expect(guide).toBeVisible();
  for (const text of ['Acme Cloud', 'Home Camera', 'Camera 001', 'Camera 002', 'Your team', 'End users']) {
    await expect(guide.getByText(text, { exact: true })).toBeVisible();
  }
  return guide;
}

test('[UI-CA-CLOUD-GUIDE-001] Cloud guide stays expanded on My Clouds with and without cloud context @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  for (const suffix of ['', `?cloudId=${cloudA}`]) {
    await page.goto(`/console/clouds${suffix}`);
    await expect(page.getByRole('link', { name: 'Open cloud', exact: true }).first()).toBeVisible();
    const guide = await expectGuide(page);
    await expect(guide.getByRole('button', { name: /close|collapse|cloud concepts/i })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.screenshot({ path: testInfo.outputPath('my-clouds.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create cloud', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create cloud', exact: true });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).not.toHaveClass(/ui-dialog-drawer/);
  await expect(createDialog.getByRole('textbox', { name: 'Name', exact: true })).toBeEditable();
  await page.keyboard.press('Escape');
  await expect(createDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create cloud', exact: true })).toBeFocused();
});

test('[UI-CA-CLOUD-GUIDE-002] Empty My Clouds retains its guide and the edit dialog keeps its default layout @smoke', async ({ page }) => {
  await login(page, 'billing_owner');
  let empty = false;
  await page.route('**/api/developer/console/clouds-context?*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.page.brand_clouds = empty ? [] : body.page.brand_clouds.map(cloud => ({ ...cloud, capabilities: [...cloud.capabilities, 'cloud.update'] }));
    if (empty) {
      body.page.owned_count = 0;
      body.page.pagination.total = 0;
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/console/clouds');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editDialog = page.getByRole('dialog', { name: 'Edit cloud', exact: true });
  await expect(editDialog).toBeVisible();
  await expect(editDialog).not.toHaveClass(/ui-dialog-drawer/);
  await expect(editDialog.getByRole('textbox', { name: 'Name', exact: true })).not.toHaveValue('');
  await editDialog.getByRole('button', { name: 'Close dialog' }).click();
  empty = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No clouds in this view' })).toBeVisible();
  await expectGuide(page);
  await expect(page.getByRole('button', { name: 'Create cloud', exact: true })).toBeEnabled();
});

test('[UI-CA-CLOUD-GUIDE-003] Overview guide is an accessible optional drawer that resets on navigation @smoke', async ({ page }, testInfo) => {
  await login(page, 'billing_owner');
  await page.goto(`/console/clouds/${cloudA}`);
  const trigger = page.getByRole('button', { name: 'Cloud concepts', exact: true });
  const drawer = page.getByRole('dialog', { name: drawerTitle, exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('region', { name: guideTitle })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('overview-closed.png'), fullPage: true });
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expectGuide(page);
  const close = drawer.getByRole('button', { name: 'Close dialog' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(box.y).toBe(0);
  expect(box.height).toBe(viewport.height);
  expect(box.width).toBe(Math.min(640, viewport.width));
  expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  if (viewport.width > 640) {
    await page.mouse.click(box.x - 15, 100);
    await expect(drawer).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('overview-drawer.png') });
  await close.click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.goto(`/console/clouds/${cloudA}/fleet`);
  await expect(drawer).toHaveCount(0);
  await page.goto(`/console/clouds/${cloudA}`);
  await expect(trigger).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await page.getByLabel('Brand Cloud', { exact: true }).selectOption(cloudB);
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudB}$`));
  await expect(trigger).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await trigger.click();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloudA}$`));
  await expect(trigger).toBeVisible();
  await expect(drawer).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
