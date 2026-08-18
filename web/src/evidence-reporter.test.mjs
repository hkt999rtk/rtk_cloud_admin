import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTestID } from '../scripts/test-evidence-reporter.mjs';

test('evidence reporter accepts standard and staging-qualified test IDs', () => {
  assert.equal(extractTestID('[UI-CA-BILLING-001] billing overview'), 'UI-CA-BILLING-001');
  assert.equal(extractTestID('[UI-CA-BILLING-STG-001] real staging overview'), 'UI-CA-BILLING-STG-001');
  assert.equal(extractTestID('missing test ID'), '');
});
