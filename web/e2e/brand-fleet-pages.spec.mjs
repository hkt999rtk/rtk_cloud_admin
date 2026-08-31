import { test, expect } from '@playwright/test';
import { expectNoCJKText, expectPageTitle, login } from './fixtures/session.mjs';

const pages = [
  ['overview', 'Device Overview'],
  ['devices', 'Devices'],
  ['product-services', 'Products and Services'],
  ['firmware-ota', 'Firmware OTA'],
  ['reports', 'Reports'],
  ['access', 'Members & Permissions'],
  ['settings', 'Settings'],
];

test('[UI-CA-FLEETPAGE-001] Brandname customer pages load through the real BFF @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  for (const [route, heading] of pages) {
    await page.goto(`/console/brand-e2e-01/${route}`);
    await expectPageTitle(page, heading);
    await expectNoCJKText(page);
    if (route === 'overview') await expect(page).toHaveTitle('Brand Cloud · RTK Cloud');
  }
});

test('[UI-CA-FLEETPAGE-005] Brand Cloud overview access and settings share one navigation entry @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/overview');
  const brandCloudEntry = page.getByRole('button', { name: 'Brand Cloud Home' });
  await expect(brandCloudEntry).toHaveClass(/active/);
  await expect(page.getByText('Device Operations', { exact: true })).toBeVisible();
  await expect(page.getByText('Products and Updates', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage Members and Access' }).click();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/access$/);
  await expect(page.getByRole('heading', { name: 'Members & Permissions' })).toBeVisible();
  await expect(brandCloudEntry).toHaveClass(/active/);
  const settingsTab = page.getByRole('button', { name: 'Settings', exact: true });
  const settingsBox = await settingsTab.boundingBox();
  expect(settingsBox).not.toBeNull();
  await page.mouse.click(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const certificateType = page.getByLabel('Certificate Type');
  await expect(certificateType).toHaveClass(/select-control/);
  const selectStyles = await certificateType.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { appearance: styles.appearance, backgroundImage: styles.backgroundImage, height: element.getBoundingClientRect().height };
  });
  expect(selectStyles.appearance).toBe('none');
  expect(selectStyles.backgroundImage).not.toBe('none');
  expect(selectStyles.height).toBeGreaterThanOrEqual(42);
  await expect(page.getByRole('link', { name: 'Open cloud management', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate and download', exact: true })).toHaveClass(/primary-button/);
  await page.goBack();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/access$/);
  await page.goto('/console/clouds/99999999-9999-4999-8999-999999999999');
  await expect(page.getByRole('heading', { name: 'Transfer ownership', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send ownership invitation', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Cloud overview', exact: true })).toBeVisible();
});

test('[UI-CA-FLEETPAGE-003] retired batch work route opens firmware upgrade status @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/jobs');
  await expect(page.getByRole('heading', { name: 'Firmware OTA' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/firmware-ota$/);
  await expect(page.getByRole('button', { name: 'Batch Tasks' })).toHaveCount(0);
});

test('[UI-CA-FLEETPAGE-002] devices remains server paginated instead of loading the whole fleet @brand-fleet @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  const requests = [];
  page.on('request', (request) => { if (request.url().includes('/api/fleet/devices')) requests.push(request.url()); });
  await page.route('**/api/fleet/devices**', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const url = new URL(route.request().url());
    await route.fulfill({
      response,
      json: {
        ...payload,
        pagination: {
          limit: 100,
          offset: Number(url.searchParams.get('offset') || 0),
          total: 1000,
        },
      },
    });
  });
  await page.goto('/console/brand-e2e-01/devices');
  await expect(page.getByRole('heading', { name: 'Devices' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Batch Settings|Batch deactivation|Select all/})).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /^Select/})).toHaveCount(0);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.some((url) => /limit=\d+/.test(url))).toBeTruthy();
  expect(requests.some((url) => /offset=/.test(url))).toBeFalsy();

  const topPagination = page.getByRole('navigation', { name: 'Devices pages (top)' });
  const bottomPagination = page.getByRole('navigation', { name: 'Devices pages (bottom)' });
  await expect(topPagination).toBeVisible();
  await expect(bottomPagination).toBeVisible();
  await expect(topPagination.getByRole('button', { name: /^Page \d+$/ })).toHaveCount(6);
  await expect(bottomPagination.getByRole('button', { name: /^Page \d+$/ })).toHaveCount(6);
  await expect(topPagination.locator('.pagination-ellipsis')).toHaveCount(1);
  const paginationBox = await topPagination.locator('.pagination-page-list').boundingBox();
  expect(paginationBox.width).toBeLessThan(320);

  if (testInfo.project.name === 'mobile') {
    const mobileRow = await page.locator('.mobile-device-row').first().boundingBox();
    expect(mobileRow.height).toBeLessThan(75);
  } else {
    const desktopRow = await page.locator('.device-table tbody tr').first().boundingBox();
    expect(desktopRow.height).toBeLessThan(55);
  }

  await topPagination.getByRole('button', { name: 'Page 5' }).click();
  await expect(page).toHaveURL(/devices\?offset=400$/);
  await expect(bottomPagination.getByRole('button', { name: 'Page 5' })).toHaveAttribute('aria-current', 'page');
  await bottomPagination.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/devices\?offset=500$/);
  await expect(topPagination).toContainText('Page 6 of 10');
});

test('[UI-CA-FLEETPAGE-006] report builder uses shared form controls @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/reports');

  const reportType = page.getByLabel('Report Type');
  await expect(reportType).toHaveClass(/select-control/);
  const selectStyles = await reportType.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { appearance: styles.appearance, backgroundImage: styles.backgroundImage, height: element.getBoundingClientRect().height };
  });
  expect(selectStyles.appearance).toBe('none');
  expect(selectStyles.backgroundImage).not.toBe('none');
  expect(selectStyles.height).toBeGreaterThanOrEqual(42);

  await expect(page.getByRole('button', { name: 'Create Report' })).toHaveClass(/primary-button/);
  const dimension = page.getByRole('checkbox', { name: 'product' });
  const checkboxStyles = await dimension.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { appearance: styles.appearance, width: element.getBoundingClientRect().width, borderRadius: styles.borderRadius };
  });
  expect(checkboxStyles.appearance).toBe('none');
  expect(checkboxStyles.width).toBe(18);
  expect(checkboxStyles.borderRadius).toBe('5px');
});

test('[UI-CA-FLEETPAGE-007] firmware status loads only after selecting a Product @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  const distributionRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/fleet/firmware-distribution')) distributionRequests.push(request.url());
  });
  await page.goto('/console/brand-e2e-01/firmware-ota');

  const productSelector = page.getByLabel('Select Firmware Product');
  await expect(productSelector).toHaveClass(/select-control/);
  await expect(page.getByRole('heading', { name: 'Please select Product first' })).toBeVisible();
  await expect(page.getByText('Latest version', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Firmware data window')).toHaveCount(0);
  expect(distributionRequests).toHaveLength(0);

  await productSelector.selectOption('product-alpha');
  await expect(page).toHaveURL(/firmware-ota\?product_id=product-alpha$/);
  await expect.poll(() => distributionRequests.some((url) => url.includes('product_id=product-alpha'))).toBeTruthy();
  await expect(page.getByText('Latest version', { exact: true })).toBeVisible();
  await expect(page.getByText(/Showing firmware versions, device distribution, and OTA update status for E2E product-alpha Camera/)).toBeVisible();

  await page.reload();
  await expect(productSelector).toHaveValue('product-alpha');
  await page.goBack();
  await expect(page).toHaveURL(/firmware-ota$/);
  await expect(page.getByRole('heading', { name: 'Please select Product first' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/firmware-ota\?product_id=product-alpha$/);
  await expect(productSelector).toHaveValue('product-alpha');
});

test('[UI-CA-FLEETPAGE-004] overview world map supports country hover zoom and pan @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/overview');
  const map = page.getByRole('img', { name: 'Zoomable and draggable world device distribution map' });
  await expect(map).toBeVisible();
  await expect(map.locator('.world-countries path')).toHaveCount(177);
  await map.locator('.world-countries path').nth(10).hover();
  await expect(page.locator('.region-map-tooltip')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('140%', { exact: true })).toBeVisible();
  const beforePan = await map.getAttribute('viewBox');
  const bounds = await map.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .5);
  await page.mouse.up();
  await expect.poll(() => map.getAttribute('viewBox')).not.toBe(beforePan);
});

test('[UI-CA-FLEETPAGE-008] Product form uses styled buttons, checkboxes, and select controls @brand-fleet', async ({ page }) => {
  await login(page, 'customer');
  await page.route('**/api/products', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ products: [], can_manage: true, source_status: 'available' }) });
  });
  await page.goto('/console/brand-e2e-01/product-services');
  const createButton = page.getByRole('button', { name: '＋ Add Product' });
  await expect(createButton).toHaveCSS('background-color', 'rgb(0, 104, 183)');
  await createButton.click();

  const category = page.locator('.product-create-form select');
  const liveView = page.getByRole('checkbox', { name: 'Live View' });
  await expect(category).toHaveCSS('appearance', 'none');
  await expect(category).not.toHaveCSS('background-image', 'none');
  await expect(liveView).toHaveCSS('appearance', 'none');
  await expect(liveView).toHaveCSS('background-color', 'rgb(0, 104, 183)');
  await expect(page.getByRole('button', { name: 'Save Product' })).toHaveCSS('background-color', 'rgb(0, 104, 183)');
});
