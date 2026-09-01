import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertVerificationReplayRejected } from './verification-replay.mjs';

const activationURL = requiredEnv('LOAD_OWNER_ACTIVATION_URL');
const password = requiredEnv('LOAD_OWNER_PASSWORD');
const expectedEmail = requiredEnv('LOAD_OWNER_EMAIL');
const expectedDisplayName = requiredEnv('LOAD_OWNER_DISPLAY_NAME');
const expectedBrandName = requiredEnv('LOAD_OWNER_BRAND_NAME');
const expectedTenant = requiredEnv('LOAD_OWNER_TENANT_SLUG');
const expectedOrigin = new URL(requiredEnv('LOAD_OWNER_ADMIN_BASE_URL')).origin;
const evidencePath = optionalEnv('LOAD_OWNER_EVIDENCE_PATH');
const runID = requiredEnv('LOAD_OWNER_RUN_ID');
const imapUID = Number(requiredEnv('LOAD_OWNER_IMAP_UID'));

const parsedActivationURL = new URL(activationURL);
if (
  parsedActivationURL.origin !== expectedOrigin ||
  parsedActivationURL.pathname.replace(/\/$/, '') !== '/signup/verify' ||
  !parsedActivationURL.searchParams.get('token')
) {
  throw new Error('activation URL is not a global signup verification URL');
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  let activationResponse;
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/customer/verify-email'
    ) activationResponse = response;
  });
  await page.goto(activationURL, { waitUntil: 'networkidle' });
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await page.waitForURL(/\/console\//, { timeout: 30_000 });
  if (!activationResponse || activationResponse.status() !== 200) {
    throw new Error(`brand owner activation returned HTTP ${activationResponse?.status() || 'unknown'}`);
  }
  const meResponse = await page.request.get(`${expectedOrigin}/api/me`);
  const me = await meResponse.json();
  if (!meResponse.ok() || me.email !== expectedEmail || !me.memberships?.some((item) => item.organization === expectedBrandName && item.role === 'owner')) {
    throw new Error(`activated global account did not expose owner membership for ${expectedTenant}`);
  }
  const cookies = await context.cookies(expectedOrigin);
  if (!cookies.some((cookie) => cookie.name === 'rtk_admin_session' && cookie.httpOnly)) {
    throw new Error('activation did not establish an HTTP-only Admin Console session');
  }
  await page.request.post(`${expectedOrigin}/api/auth/logout`);
  await context.close();

  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginPage.goto(`${expectedOrigin}/login`, { waitUntil: 'networkidle' });
  await loginPage.getByLabel('Email', { exact: true }).fill(expectedEmail);
  await loginPage.getByLabel('Password', { exact: true }).fill(password);
  await loginPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await loginPage.waitForURL(/\/console\//, { timeout: 30_000 });
  await loginContext.close();

  const replayContext = await browser.newContext();
  const replayPage = await replayContext.newPage();
  await assertVerificationReplayRejected(replayPage, activationURL, password);
  await replayContext.close();
} finally {
  await browser.close();
}

if (evidencePath) {
  await writeFile(evidencePath, `${JSON.stringify({
    schema: 'rtk.load-owner-activation.evidence.v1',
    run_id: runID,
    status: 'PASS',
    brand_name: expectedBrandName,
    tenant_slug: expectedTenant,
    recipient_alias: expectedEmail,
    imap_uid: imapUID,
    activation_origin: expectedOrigin,
    activation: 'PASS',
    session: 'PASS',
    replay: 'PASS',
  })}\n`, { encoding: 'utf8', mode: 0o600 });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || '';
}
