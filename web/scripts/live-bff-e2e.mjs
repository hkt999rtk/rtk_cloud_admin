import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const baseURL = requiredEnv('LIVE_BFF_BASE_URL').replace(/\/$/, '');
const customerSessionID = requiredEnv('E2E_CUSTOMER_SESSION_ID');
const platformSessionID = requiredEnv('E2E_PLATFORM_SESSION_ID');
const accountDeviceID = process.env.E2E_ACCOUNT_DEVICE_1 || 'dev-001';
const artifactsDir = process.env.E2E_ARTIFACTS_DIR || path.join(repoRoot, '.artifacts', 'live-video-cloud-e2e');

await mkdir(artifactsDir, { recursive: true });

const browser = await chromium.launch();
const consoleIssues = [];

try {
  const customerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await addSessionCookie(customerContext, customerSessionID);
  const customerPage = await customerContext.newPage();
  collectConsoleIssues(customerPage, consoleIssues, 'customer');

  await gotoAndAssert(customerPage, '/console/overview', 'Fleet Health Overview');
  await expectText(customerPage, 'Online Rate');
  await expectText(customerPage, 'Needs Attention');
  await screenshot(customerPage, 'customer-overview.png');

  await gotoAndAssert(customerPage, `/console/devices?device=${encodeURIComponent(accountDeviceID)}`, 'Devices');
  await expectText(customerPage, 'Device detail');
  await expectText(customerPage, 'Provision device');
  await screenshot(customerPage, 'customer-devices-drawer.png');

  await gotoAndAssert(customerPage, '/console/firmware-ota', 'Firmware & OTA');
  await expectText(customerPage, 'Firmware distribution');
  await expectText(customerPage, 'Rollout Campaigns');
  await screenshot(customerPage, 'customer-firmware.png');

  await gotoAndAssert(customerPage, '/console/stream-health', 'Stream Health');
  await expectText(customerPage, 'Worst devices');
  await screenshot(customerPage, 'customer-stream-health.png');
  await customerContext.close();

  const platformContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await addSessionCookie(platformContext, platformSessionID);
  const platformPage = await platformContext.newPage();
  collectConsoleIssues(platformPage, consoleIssues, 'platform');
  await gotoAndAssert(platformPage, '/admin/ops', 'Operations');
  await expectText(platformPage, 'Lifecycle operations');
  await expectText(platformPage, 'Friendly Summary');
  await screenshot(platformPage, 'platform-operations.png');
  await platformContext.close();

  if (consoleIssues.length) {
    throw new Error(`Console issues detected:\n${consoleIssues.join('\n')}`);
  }

  console.log(`Live BFF browser E2E passed. Screenshots: ${artifactsDir}`);
} finally {
  await browser.close();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function addSessionCookie(context, value) {
  await context.addCookies([{
    name: 'rtk_admin_session',
    value,
    url: baseURL,
    httpOnly: true,
    sameSite: 'Lax',
  }]);
}

function collectConsoleIssues(page, issues, label) {
  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    issues.push(`${label} ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    issues.push(`${label} pageerror: ${error.message}`);
  });
}

async function gotoAndAssert(page, routePath, expectedText) {
  await page.goto(`${baseURL}${routePath}`, { waitUntil: 'networkidle' });
  await expectText(page, expectedText);
  const rootText = await page.locator('#root').innerText({ timeout: 5000 });
  if (!rootText.trim()) {
    throw new Error(`Blank app shell at ${routePath}`);
  }
  if (/Internal server error|vite|webpack|ReferenceError|TypeError/.test(rootText)) {
    throw new Error(`Framework/runtime overlay detected at ${routePath}`);
  }
}

async function expectText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(artifactsDir, name), fullPage: false });
}
