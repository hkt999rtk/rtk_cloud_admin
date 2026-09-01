import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const script of ['email-signup-live-e2e.mjs', 'load-owner-activation-live-e2e.mjs']) {
  test(`${script} follows the canonical sign-in button label`, async () => {
    const source = await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    assert.match(source, /getByRole\('button', \{ name: 'Sign in', exact: true \}\)/);
    assert.doesNotMatch(source, /getByRole\('button', \{ name: 'Login', exact: true \}\)/);
  });
}
