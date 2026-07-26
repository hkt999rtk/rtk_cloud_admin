import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

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
  parsedActivationURL.pathname.replace(/\/$/, '') !== '/brand-cloud/activate' ||
  parsedActivationURL.searchParams.get('tenant') !== expectedTenant ||
  !parsedActivationURL.searchParams.get('token')
) {
  throw new Error('activation URL does not match the expected staging tenant');
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  let activationResponse;
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/brand-cloud/activate'
    ) activationResponse = response;
  });
  await page.goto(activationURL, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('New password').fill(password);
  await page.getByRole('button', { name: 'Activate account' }).click();
  await page.getByText(`Activated ${expectedDisplayName} for ${expectedBrandName}.`, { exact: true }).waitFor({ timeout: 30_000 });
  if (!activationResponse || activationResponse.status() !== 200) {
    throw new Error(`brand owner activation returned HTTP ${activationResponse?.status() || 'unknown'}`);
  }
  const body = await activationResponse.json();
  if (
    body.brand_cloud?.name !== expectedBrandName ||
    body.brand_cloud?.tenant_slug !== expectedTenant ||
    body.account?.email !== expectedEmail ||
    body.account?.display_name !== expectedDisplayName
  ) {
    throw new Error('activation response did not match the resolved brand plan');
  }
  const cookies = await context.cookies(expectedOrigin);
  if (!cookies.some((cookie) => cookie.name === 'rtk_admin_session' && cookie.httpOnly)) {
    throw new Error('activation did not establish an HTTP-only Admin Console session');
  }
  await context.close();

  const replayContext = await browser.newContext();
  const replayPage = await replayContext.newPage();
  let replayResponse;
  replayPage.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/brand-cloud/activate'
    ) replayResponse = response;
  });
  await replayPage.goto(activationURL, { waitUntil: 'networkidle' });
  await replayPage.getByPlaceholder('New password').fill(password);
  await replayPage.getByRole('button', { name: 'Activate account' }).click();
  await replayPage.locator('.error').first().waitFor({ state: 'visible', timeout: 30_000 });
  if (!replayResponse || replayResponse.status() !== 400) {
    throw new Error(`replayed activation token returned HTTP ${replayResponse?.status() || 'unknown'}`);
  }
  const replayText = await replayPage.locator('.error').first().innerText();
  if (replayText.includes(parsedActivationURL.searchParams.get('token'))) {
    throw new Error('replay error exposed the activation token');
  }
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
