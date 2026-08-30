import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { assertVerificationReplayRejected } from './verification-replay.mjs';

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
  await verifyPage.getByLabel('New password', { exact: true }).fill(password);
  await verifyPage.getByRole('button', { name: 'Verify and continue', exact: true }).click();
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
  const me = await meResponse.json();
  if (!me.memberships?.some((membership) => membership.organization === emailAddress.toLowerCase() && membership.role === 'owner')) {
    throw new Error('verified account did not own its default signup organization');
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
  await assertVerificationReplayRejected(replayPage, delivered.url, password);
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
    workflow: {
      workflow_id: 'WF-AM-SIGNUP-001',
      steps: {
        submit_signup: 'PASS',
        verify_email: 'PASS',
        read_authenticated_user: 'PASS',
        password_login: 'PASS',
        reject_token_replay: 'PASS',
      },
    },
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
