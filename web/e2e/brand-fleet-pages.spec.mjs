import { test, expect } from '@playwright/test';
import { login } from './fixtures/session.mjs';

const pages = [
  ['overview', '設備總覽'],
  ['devices', '設備'],
  ['sku-services', 'SKU 與服務'],
  ['firmware-ota', '韌體更新'],
  ['jobs', '批次工作'],
  ['reports', '報表'],
  ['access', '成員與權限'],
  ['settings', '設定'],
  ['provisioning', '設備註冊'],
];

test('[UI-CA-FLEETPAGE-001] Brandname customer pages load through the real BFF @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  for (const [route, heading] of pages) {
    await page.goto(`/console/brand-e2e-01/${route}`);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
  }
});

test('[UI-CA-FLEETPAGE-003] Brand Cloud overview access and settings share one navigation entry @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/overview');
  const brandCloudEntry = page.getByRole('button', { name: '品牌雲首頁' });
  await expect(brandCloudEntry).toHaveClass(/active/);
  await expect(page.getByText('設備營運', { exact: true })).toBeVisible();
  await expect(page.getByText('產品與更新', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '管理成員與權限' }).click();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/access$/);
  await expect(page.getByRole('heading', { name: '成員與權限' })).toBeVisible();
  await expect(brandCloudEntry).toHaveClass(/active/);
  const settingsTab = page.getByRole('button', { name: '設定', exact: true });
  const settingsBox = await settingsTab.boundingBox();
  expect(settingsBox).not.toBeNull();
  await page.mouse.click(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/settings$/);
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  const certificateType = page.getByLabel('憑證類型');
  await expect(certificateType).toHaveClass(/select-control/);
  const selectStyles = await certificateType.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { appearance: styles.appearance, backgroundImage: styles.backgroundImage, height: element.getBoundingClientRect().height };
  });
  expect(selectStyles.appearance).toBe('none');
  expect(selectStyles.backgroundImage).not.toBe('none');
  expect(selectStyles.height).toBeGreaterThanOrEqual(42);
  await expect(page.getByRole('button', { name: '接受轉移', exact: true })).toHaveClass(/primary-button/);
  await expect(page.getByRole('button', { name: '建立轉移', exact: true })).toHaveClass(/primary-button/);
  await expect(page.getByRole('button', { name: '產生並下載', exact: true })).toHaveClass(/primary-button/);
  await page.goBack();
  await expect(page).toHaveURL(/\/console\/brand-e2e-01\/access$/);
});

test('[UI-CA-FLEETPAGE-002] devices remains server paginated instead of loading the whole fleet @brand-fleet @smoke', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: '設備' })).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.some((url) => /limit=\d+/.test(url))).toBeTruthy();
  expect(requests.some((url) => /offset=/.test(url))).toBeFalsy();

  const topPagination = page.getByRole('navigation', { name: '設備分頁（上方）' });
  const bottomPagination = page.getByRole('navigation', { name: '設備分頁（下方）' });
  await expect(topPagination).toBeVisible();
  await expect(bottomPagination).toBeVisible();
  await expect(topPagination.getByRole('button', { name: /^第 \d+ 頁$/ })).toHaveCount(10);
  await expect(bottomPagination.getByRole('button', { name: /^第 \d+ 頁$/ })).toHaveCount(10);

  await topPagination.getByRole('button', { name: '第 5 頁' }).click();
  await expect(page).toHaveURL(/devices\?offset=400$/);
  await expect(bottomPagination.getByRole('button', { name: '第 5 頁' })).toHaveAttribute('aria-current', 'page');
  await bottomPagination.getByRole('button', { name: '下一頁' }).click();
  await expect(page).toHaveURL(/devices\?offset=500$/);
  await expect(topPagination).toContainText('第 6 / 10 頁');
});

test('[UI-CA-FLEETPAGE-004] report builder uses shared form controls @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  await page.goto('/console/brand-e2e-01/reports');

  const reportType = page.getByLabel('報表類型');
  await expect(reportType).toHaveClass(/select-control/);
  const selectStyles = await reportType.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { appearance: styles.appearance, backgroundImage: styles.backgroundImage, height: element.getBoundingClientRect().height };
  });
  expect(selectStyles.appearance).toBe('none');
  expect(selectStyles.backgroundImage).not.toBe('none');
  expect(selectStyles.height).toBeGreaterThanOrEqual(42);

  await expect(page.getByRole('button', { name: '建立報表' })).toHaveClass(/primary-button/);
  const dimension = page.getByRole('checkbox', { name: 'sku' });
  const checkboxStyles = await dimension.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { appearance: styles.appearance, width: element.getBoundingClientRect().width, borderRadius: styles.borderRadius };
  });
  expect(checkboxStyles.appearance).toBe('none');
  expect(checkboxStyles.width).toBe(18);
  expect(checkboxStyles.borderRadius).toBe('5px');
});

test('[UI-CA-FLEETPAGE-005] firmware status loads only after selecting a SKU @brand-fleet @smoke', async ({ page }) => {
  await login(page, 'developer');
  const distributionRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/fleet/firmware-distribution')) distributionRequests.push(request.url());
  });
  await page.goto('/console/brand-e2e-01/firmware-ota');

  const skuSelector = page.getByLabel('選擇 Firmware SKU');
  await expect(skuSelector).toHaveClass(/select-control/);
  await expect(page.getByRole('heading', { name: '請先選擇 SKU' })).toBeVisible();
  await expect(page.getByText('Latest Version', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Firmware data window')).toHaveCount(0);
  expect(distributionRequests).toHaveLength(0);

  await skuSelector.selectOption('sku-alpha');
  await expect(page).toHaveURL(/firmware-ota\?sku_id=sku-alpha$/);
  await expect.poll(() => distributionRequests.some((url) => url.includes('sku_id=sku-alpha'))).toBeTruthy();
  await expect(page.getByText('Latest Version', { exact: true })).toBeVisible();
  await expect(page.getByText(/目前顯示 E2E sku-alpha Camera/)).toBeVisible();

  await page.reload();
  await expect(skuSelector).toHaveValue('sku-alpha');
  await page.goBack();
  await expect(page).toHaveURL(/firmware-ota$/);
  await expect(page.getByRole('heading', { name: '請先選擇 SKU' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/firmware-ota\?sku_id=sku-alpha$/);
  await expect(skuSelector).toHaveValue('sku-alpha');
});
