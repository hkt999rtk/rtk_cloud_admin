// A consumed link is rejected before the password form is displayed. Also
// exercise the submission endpoint directly so UI rejection cannot mask reuse.
export async function assertVerificationReplayRejected(page, activationURL, password) {
  const activation = new URL(activationURL);
  const token = activation.searchParams.get('token');
  if (!token) throw new Error('replay verification requires an activation token');
  const [statusResponse] = await Promise.all([
    page.waitForResponse((response) => (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/customer/verification-status'
    ), { timeout: 30_000 }),
    page.goto(activationURL, { waitUntil: 'networkidle' }),
  ]);
  if (statusResponse.status() !== 200 || (await statusResponse.json()).status !== 'invalid') {
    throw new Error('consumed verification link was not classified as invalid');
  }
  await page.getByText('This verification link is invalid.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  if (await page.getByLabel('New password', { exact: true }).count()) {
    throw new Error('consumed verification link still exposes a password form');
  }
  if (new URL(page.url()).searchParams.has('token') || (await page.locator('body').innerText()).includes(token)) {
    throw new Error('consumed verification link exposed its activation token');
  }
  const replayResponse = await page.request.post(`${activation.origin}/api/auth/customer/verify-email`, {
    data: { token, new_password: password },
  });
  if (replayResponse.status() !== 400) {
    throw new Error(`replayed verification submission returned HTTP ${replayResponse.status()}`);
  }
  if ((await replayResponse.text()).includes(token)) {
    throw new Error('replayed verification response exposed its activation token');
  }
}
