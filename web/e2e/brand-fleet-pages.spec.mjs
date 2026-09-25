import { test, expect } from '@playwright/test';
import { expectNoCJKText, expectPageTitle, login } from './fixtures/session.mjs';

const cloud = '33333333-3333-4333-8333-333333333333';
const product = '55555555-5555-4555-8555-555555555555';
const pages = [
  ['', 'Cloud Overview'],
  ['/fleet', 'Devices'],
  ['/products', 'Products'],
  ['/firmware-ota', 'Firmware OTA'],
  ['/analytics', 'Reports'],
  ['/members', 'Members and sharing'],
  ['/settings', 'Cloud settings'],
];

test('[UI-CA-FLEETPAGE-001] Brandname customer pages load through the real BFF @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  for (const [route, heading] of pages) {
    await page.goto(`/console/clouds/${cloud}${route}`);
    await expectPageTitle(page, heading);
    await expectNoCJKText(page);
    if (route === '') await expect(page).toHaveTitle('Brand Cloud · RTK Cloud');
  }
});

test('[UI-CA-FLEETPAGE-005] Brand Cloud overview access and settings share one navigation entry @brand-fleet @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  await page.goto(`/console/clouds/${cloud}`);
  const overview = page.getByRole('link', { name: 'Overview', exact: true });
  await expect(overview).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Features', { exact: true })).toBeVisible();
  await expect(page.getByText('Management', { exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Members & Access', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloud}/members$`));
  await expect(page.getByRole('heading', { name: 'Members and sharing' })).toBeVisible();
  await expect(page.locator('.my-clouds-heading').getByRole('heading')).toHaveCount(0);
  await expect(page.getByText('Manage who can access this cloud and its products.', { exact: false })).toBeVisible();
  await expect(page.getByText('Start with read-only access to selected Products', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Members & Access', exact: true })).toHaveAttribute('aria-current', 'page');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloud}/settings$`));
  await expect(page.getByRole('heading', { name: 'Cloud settings', exact: true })).toBeVisible();
  await expect(page.locator('.my-clouds-heading').getByRole('heading')).toHaveCount(0);
  await expect(page.getByText('Manage cloud details, ownership and lifecycle.', { exact: false })).toBeVisible();
  const settingsPanel = page.locator('section.my-clouds-panel').filter({ has: page.getByRole('heading', { name: 'Cloud settings', exact: true }) });
  for (const label of ['Cloud name', 'Description', 'Cloud ID', 'Tenant slug', 'Owner email', 'Owner ID', 'My role']) {
    await expect(settingsPanel.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(settingsPanel.getByText('E2E Alpha Cloud', { exact: true })).toBeVisible();
  await expect(settingsPanel.getByText('developer@example.com', { exact: true })).toBeVisible();
  await expect(settingsPanel.getByText('developer-user', { exact: true })).toBeVisible();
  await expect(settingsPanel.getByText(cloud, { exact: true })).toBeVisible();
  await page.getByText('Transfer cloud ownership', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer ownership', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloud}/members$`));
  await page.goto('/console/clouds/99999999-9999-4999-8999-999999999999/settings');
  await page.getByText('Transfer cloud ownership', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transfer ownership', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send ownership invitation', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Cloud settings', exact: true })).toBeVisible();
});

test('[UI-CA-FLEETPAGE-003] retired batch work route opens firmware upgrade status @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto(`/console/${cloud}/jobs`);
  await expect(page.getByRole('heading', { name: 'Firmware OTA' }).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/console/clouds/${cloud}/firmware-ota$`));
  await expect(page.getByRole('button', { name: 'Batch Tasks' })).toHaveCount(0);
});

test('[UI-CA-FLEETPAGE-002] devices remains server paginated instead of loading the whole fleet @brand-fleet @smoke', async ({ page }, testInfo) => {
  await login(page, 'developer');
  const requests = [];
  const fleetAPI = `/api/developer/brand-clouds/${cloud}/fleet/devices`;
  page.on('request', (request) => { if (request.url().includes(fleetAPI)) requests.push(request.url()); });
  await page.route(`**${fleetAPI}**`, async (route) => {
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
  await page.goto(`/console/clouds/${cloud}/fleet`);
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

  await page.route(`**/api/developer/brand-clouds/${cloud}/devices/*/telemetry`, route => route.fulfill({ json: {
    telemetry_status: 'unavailable', unavailable_reason: 'Video Cloud telemetry source is not configured.',
    health: 'warning', firmware_version: 'v1.2.4', active_stream_status: 'unavailable', recent_events: [],
  } }));
  if (testInfo.project.name === 'mobile') await page.locator('.mobile-device-row').first().click();
  else await page.locator('.device-table tbody tr').first().click();
  const drawer = page.locator('.drawer-panel').filter({ has: page.locator('.source-facts') });
  await expect(drawer).toContainText('Video Cloud telemetry source is not configured.');
  if (testInfo.project.name === 'mobile') {
    await drawer.locator('.drawer-close').click();
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  if (testInfo.project.name === 'mobile') {
    await page.locator('.mobile-nav-close').click();
    await page.locator('.mobile-device-row').first().click();
  }
  await expect(drawer).toContainText('帳戶登錄資料');
  await expect(drawer).toContainText('雲端啟用');
  await expect(drawer).toContainText('連線狀態');
  await expect(drawer).toContainText('尚未設定 Video Cloud 遙測來源。');
  await expect(drawer).toContainText('使用中的串流');
  await expect(drawer).toContainText('最後一次上線');
  await expect(drawer).toContainText('您目前沒有執行此裝置操作的權限。');
  await expect(drawer).not.toContainText('韌體中的程式）');
  await drawer.locator('.drawer-close').click();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '開啟導覽' }).click();
  await page.locator('[data-locale-selector]').selectOption('en');
  if (testInfo.project.name === 'mobile') await page.locator('.mobile-nav-close').click();

  if (testInfo.project.name === 'mobile') {
    const mobileRow = await page.locator('.mobile-device-row').first().boundingBox();
    expect(mobileRow.height).toBeLessThan(75);
  } else {
    const desktopRow = await page.locator('.device-table tbody tr').first().boundingBox();
    expect(desktopRow.height).toBeLessThanOrEqual(64);
  }

  await topPagination.getByRole('button', { name: 'Page 5' }).click();
  await expect(page).toHaveURL(/fleet\?offset=400$/);
  await expect(bottomPagination.getByRole('button', { name: 'Page 5' })).toHaveAttribute('aria-current', 'page');
  await bottomPagination.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/fleet\?offset=500$/);
  await expect(topPagination).toContainText('Page 6 of 10');
});

test('[UI-CA-FLEETPAGE-009] device ID search keeps its input mounted and shows IDs @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  const fleetAPI = `/api/developer/brand-clouds/${cloud}/fleet/devices`;
  await page.route(`**${fleetAPI}**`, route => route.fulfill({ json: {
    devices: [{ id: 'dev-search-001', name: 'Test device', organization: 'E2E Alpha Cloud', model: 'TEST', serial_number: 'SERIAL-001', firmware_version: 'v1.2.4', health: 'warning', readiness: 'registered', source_facts: [] }],
    pagination: { limit: 100, offset: 0, total: 1 },
    source_status: 'available',
  } }));
  await page.goto(`/console/clouds/${cloud}/fleet`);
  const search = page.getByRole('textbox', { name: 'Search device ID' });
  await expect(search).toBeVisible();
  await expect(page.locator('.device-table tbody tr').first()).toContainText('dev-search-001');
  await expect(page.locator('.device-table tbody tr').first()).toContainText('Test device');
  await search.evaluate(element => { element.dataset.preserved = 'yes'; });
  await search.fill('dev-search');
  await expect(page).toHaveURL(/q=dev-search/);
  await expect(search).toHaveAttribute('data-preserved', 'yes');
  await expect(search).toBeFocused();
  await page.locator('.device-table tbody tr').first().click();
  await expect(page.locator('.drawer-header h2')).toHaveText('dev-search-001');
  const badgeColors = await page.locator('.drawer-summary .status').evaluateAll(elements => elements.map(element => getComputedStyle(element).color));
  expect(badgeColors).toEqual(['rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
  await page.locator('.drawer-close').click();
  await page.locator('[data-locale-selector]').selectOption('zh-TW');
  await expect(page.getByRole('button', { name: '檢視', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: '搜尋裝置 ID' })).toBeVisible();
});

test('[UI-CA-FLEETPAGE-006] report builder uses shared form controls @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto(`/console/clouds/${cloud}/analytics`);

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
    if (request.url().includes(`/api/developer/brand-clouds/${cloud}/fleet/firmware-distribution`)) distributionRequests.push(request.url());
  });
  await page.goto(`/console/clouds/${cloud}/firmware-ota`);

  const productSelector = page.getByLabel('Select Firmware Product');
  await expect(productSelector).toHaveClass(/select-control/);
  await expect(page.getByRole('heading', { name: 'Please select Product first' })).toBeVisible();
  await expect(page.getByText('Latest version', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Firmware data window')).toHaveCount(0);
  expect(distributionRequests).toHaveLength(0);

  await productSelector.selectOption(product);
  await expect(page).toHaveURL(new RegExp(`firmware-ota\\?product_id=${product}$`));
  await expect.poll(() => distributionRequests.some((url) => url.includes(`product_id=${product}`))).toBeTruthy();
  await expect(page.getByText('Latest version', { exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`Showing firmware versions, device distribution, and OTA update status for E2E ${product} Camera`))).toBeVisible();

  await page.reload();
  await expect(productSelector).toHaveValue(product);
  await page.goBack();
  await expect(page).toHaveURL(/firmware-ota$/);
  await expect(page.getByRole('heading', { name: 'Please select Product first' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`firmware-ota\\?product_id=${product}$`));
  await expect(productSelector).toHaveValue(product);
});

test('[UI-CA-FLEETPAGE-004] overview compares regional device counts without a map @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto(`/console/clouds/${cloud}`);
  const regionPanel = page.locator('.region-fleet-panel');
  await expect(regionPanel.getByRole('heading', { name: 'Device Status by Region' })).toBeVisible();
  await expect(regionPanel.locator('.region-bar-row')).not.toHaveCount(0);
  await expect(regionPanel.getByText('Compare fleet size by region and device count.')).toBeVisible();
  await expect(regionPanel.locator('.region-map-vector')).toHaveCount(0);
});

test('[UI-CA-FLEETPAGE-008] Product form uses styled buttons, checkboxes, and select controls @brand-fleet', async ({ page }) => {
  await login(page, 'developer');
  await page.goto(`/console/clouds/${cloud}/products`);
  const createButton = page.getByRole('button', { name: 'Create Product', exact: true });
  await expect(createButton).toBeVisible();
  await createButton.click();

  const category = page.getByLabel('Product category', { exact: true });
  const mqtt = page.getByRole('checkbox', { name: 'MQTT', exact: true });
  await expect(category).toBeVisible();
  await expect(mqtt).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save Product' })).toHaveCSS('background-color', 'rgb(0, 104, 183)');
});
