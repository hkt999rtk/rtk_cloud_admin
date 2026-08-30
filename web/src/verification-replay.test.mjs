import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVerificationReplayRejected } from '../scripts/verification-replay.mjs';

const activationURL = 'https://admin.example/signup/verify?token=consumed-test-token';
const password = 'test-password';

function replayPage(options = {}) {
  const calls = [];
  const page = {
    async waitForResponse(predicate) {
      calls.push('listen');
      const response = {
        request: () => ({ method: () => 'POST' }),
        url: () => 'https://admin.example/api/auth/customer/verification-status',
        status: () => options.statusHTTP ?? 200,
        json: async () => ({ status: options.linkStatus ?? 'invalid' }),
      };
      assert.equal(predicate({ ...response, request: () => ({ method: () => 'GET' }) }), false);
      assert.equal(predicate({ ...response, url: () => 'https://admin.example/api/me' }), false);
      assert.equal(predicate(response), true);
      return response;
    },
    async goto(url) { assert.equal(url, activationURL); calls.push('navigate'); },
    getByText(text, exact) {
      assert.equal(text, 'This verification link is invalid.');
      assert.deepEqual(exact, { exact: true });
      return { async waitFor({ state }) { assert.equal(state, 'visible'); calls.push('invalid-visible'); } };
    },
    getByLabel(label) {
      assert.equal(label, 'New password');
      return { count: async () => options.formCount ?? 0 };
    },
    url: () => options.url ?? 'https://admin.example/signup/verify',
    locator(selector) {
      assert.equal(selector, 'body');
      return { innerText: async () => options.body ?? 'This verification link is invalid.' };
    },
    request: {
      async post(url, { data }) {
        assert.equal(url, 'https://admin.example/api/auth/customer/verify-email');
        assert.deepEqual(data, { token: 'consumed-test-token', new_password: password });
        calls.push('submit-replay');
        return { status: () => options.replayHTTP ?? 400, text: async () => options.replayBody ?? '{"error":"invalid token"}' };
      },
    },
  };
  return { page, calls };
}

test('verification replay requires both invalid-link UI and server-side reuse rejection', async () => {
  const { page, calls } = replayPage();
  await assertVerificationReplayRejected(page, activationURL, password);
  assert.deepEqual(calls, ['listen', 'navigate', 'invalid-visible', 'submit-replay']);
});

test('verification replay fails closed for inconsistent status and visible password forms', async () => {
  for (const options of [{ statusHTTP: 500 }, { linkStatus: 'valid' }, { linkStatus: 'expired' }, { formCount: 1 }]) {
    const { page, calls } = replayPage(options);
    await assert.rejects(assertVerificationReplayRejected(page, activationURL, password), /not classified as invalid|still exposes a password form/);
    assert.equal(calls.includes('submit-replay'), false);
  }
});

test('verification replay rejects a successful reuse even after the UI rejects the link', async () => {
  await assert.rejects(assertVerificationReplayRejected(replayPage({ replayHTTP: 200 }).page, activationURL, password), /returned HTTP 200/);
});

test('verification replay rejects token leakage without echoing the token in its errors', async () => {
  for (const options of [{ url: activationURL }, { body: 'consumed-test-token' }, { replayBody: 'consumed-test-token' }]) {
    await assert.rejects(assertVerificationReplayRejected(replayPage(options).page, activationURL, password), (error) => {
      assert.match(error.message, /exposed its activation token/);
      assert.equal(error.message.includes('consumed-test-token'), false);
      return true;
    });
  }
});

test('verification replay rejects missing tokens before navigation', async () => {
  const { page, calls } = replayPage();
  await assert.rejects(assertVerificationReplayRejected(page, 'https://admin.example/signup/verify', password), /requires an activation token/);
  assert.deepEqual(calls, []);
});
