import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const baseURL = requiredEnv('EMAIL_E2E_ADMIN_BASE_URL').replace(/\/$/, '');
const accountManagerBaseURL = requiredEnv('EMAIL_E2E_ACCOUNT_MANAGER_BASE_URL').replace(/\/$/, '');
const emailAddress = optionalEnv('EMAIL_E2E_SIGNUP_EMAIL') || requiredEnv('IMAP_EMAIL_ADDR');
const password = requiredEnv('EMAIL_E2E_SIGNUP_PASSWORD');
const imapHelper = requiredEnv('EMAIL_E2E_IMAP_HELPER');
const runID = optionalEnv('EMAIL_E2E_RUN_ID') || 'local';
const evidencePath = optionalEnv('EMAIL_E2E_EVIDENCE_PATH');
const python = process.env.PYTHON || 'python3';

const snapshot = await runIMAP('snapshot');
if (!Number.isInteger(snapshot.uid_next) || snapshot.uid_next < 1) {
  throw new Error('IMAP snapshot did not return a valid UIDNEXT');
}

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
let delivered;
try {
  const signupContext = await browser.newContext();
  const signupPage = await signupContext.newPage();
  await signupPage.goto(`${baseURL}/signup`, { waitUntil: 'networkidle' });
  await signupPage.getByLabel('Email', { exact: true }).fill(emailAddress);
  await signupPage.getByLabel('Password', { exact: true }).fill(password);
  await signupPage.getByLabel('Organization name', { exact: true }).fill(`E2E Email Signup ${runID}`);
  await signupPage.getByLabel('Display name', { exact: true }).fill(`E2E Email Signup ${runID}`);
  await signupPage.getByLabel('I accept the evaluation-tier terms.').check();
  await signupPage.getByRole('button', { name: 'Create account' }).click();
  await signupPage.waitForURL(/\/signup\/check-email(?:\?|$)/, { timeout: 30_000 });
  await signupPage.getByText('We sent a verification link', { exact: false }).waitFor();
  await signupContext.close();

  delivered = await runIMAP(
    'wait',
    '--uid-start',
    String(snapshot.uid_next),
    '--timeout',
    process.env.EMAIL_E2E_IMAP_TIMEOUT || '180',
  );
  validateDelivery(delivered);

  const verifyContext = await browser.newContext();
  const verifyPage = await verifyContext.newPage();
  let verifyResponse;
  const verifyResponsePromise = verifyPage.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/auth/customer/verify-email'
  ), { timeout: 30_000 }).then((response) => {
    verifyResponse = response;
    return response;
  });
  await verifyPage.goto(delivered.url, { waitUntil: 'networkidle' });
  await Promise.race([
    verifyResponsePromise,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (!verifyResponse) {
    const verifyButton = verifyPage.getByRole('button', { name: 'Verify', exact: true });
    if (await verifyButton.isEnabled()) {
      await verifyButton.click();
    }
  }
  verifyResponse = await verifyResponsePromise;
  if (verifyResponse.status() !== 200) {
    throw new Error(`email verification returned HTTP ${verifyResponse.status()}`);
  }
  await verifyPage.waitForURL(/\/console\/overview(?:\?|$)/, { timeout: 30_000 });
  const sessionCookies = await verifyContext.cookies(baseURL);
  if (!sessionCookies.some((cookie) => cookie.name === 'rtk_admin_session' && cookie.httpOnly)) {
    throw new Error('verification did not establish an HTTP-only Admin Console session');
  }
  const meResponse = await verifyPage.request.get(`${baseURL}/api/me`);
  if (!meResponse.ok()) {
    throw new Error(`verified Admin Console session returned HTTP ${meResponse.status()}`);
  }
  await verifyContext.close();

  const loginResponse = await fetch(`${accountManagerBaseURL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailAddress, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`verified account login returned HTTP ${loginResponse.status}`);
  }
  const loginBody = await loginResponse.json();
  if (!loginBody.user?.email_verified || loginBody.user?.signup_pending_verification) {
    throw new Error('verified account state is inconsistent');
  }
  if (!loginBody.tokens?.access_token || !loginBody.tokens?.refresh_token) {
    throw new Error('verified account login did not issue tokens');
  }

  const passwordContext = await browser.newContext();
  const passwordPage = await passwordContext.newPage();
  await passwordPage.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
  await passwordPage.getByLabel('Email', { exact: true }).fill(emailAddress);
  await passwordPage.getByLabel('Password', { exact: true }).fill(password);
  await passwordPage.getByRole('button', { name: 'Login', exact: true }).click();
  await passwordPage.waitForURL(/\/console\/overview(?:\?|$)/, { timeout: 30_000 });
  await passwordContext.close();

  const replayContext = await browser.newContext();
  const replayPage = await replayContext.newPage();
  const replayResponsePromise = replayPage.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/auth/customer/verify-email'
  ));
  await replayPage.goto(delivered.url, { waitUntil: 'networkidle' });
  const replayResponse = await replayResponsePromise;
  if (replayResponse.status() !== 400) {
    throw new Error(`replayed verification token returned HTTP ${replayResponse.status()}`);
  }
  const replayError = replayPage.locator('.error').first();
  await replayError.waitFor({ state: 'visible', timeout: 30_000 });
  const replayErrorText = await replayError.innerText();
  if (!/invalid|expired/i.test(replayErrorText) || replayErrorText.includes(new URL(delivered.url).searchParams.get('token'))) {
    throw new Error('replayed verification error was missing or exposed the token');
  }
  await replayContext.close();
} finally {
  await browser.close();
}

if (evidencePath) {
  await writeFile(evidencePath, `${JSON.stringify({
    schema: 'rtk.email-signup-e2e.evidence.v1',
    run_id: runID,
    status: 'PASS',
    imap_uid: delivered.uid,
    verification_origin: new URL(delivered.url).origin,
  })}\n`, { encoding: 'utf8', mode: 0o600 });
}
console.log(`Send Mail + IMAP signup E2E passed (run ${runID}; IMAP UID ${delivered.uid}).`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || '';
}

async function runIMAP(...args) {
  try {
    const { stdout } = await execFileAsync(python, [imapHelper, ...args], {
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: 210_000,
    });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = String(error?.stderr || '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 300);
    throw new Error(`IMAP ${args[0]} step failed${detail ? `: ${detail}` : ''}`);
  }
}

function validateDelivery(result) {
  if (
    !result?.url ||
    !Number.isInteger(result.uid) ||
    !result.message_id_present ||
    !result.multipart_alternative ||
    !result.text_part_present ||
    !result.html_part_present
  ) {
    throw new Error('received verification email did not satisfy MIME requirements');
  }
  const parsed = new URL(result.url);
  const expected = new URL(baseURL);
  if (
    parsed.origin !== expected.origin ||
    parsed.pathname.replace(/\/$/, '') !== '/signup/verify' ||
    !parsed.searchParams.get('token')
  ) {
    throw new Error('verification email URL did not match the local Admin Console');
  }
}
