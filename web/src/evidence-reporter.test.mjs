import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import EvidenceReporter, { extractTestID } from '../scripts/test-evidence-reporter.mjs';

test('evidence reporter accepts standard and staging-qualified test IDs', () => {
  assert.equal(extractTestID('[UI-CA-BILLING-001] billing overview'), 'UI-CA-BILLING-001');
  assert.equal(extractTestID('[UI-CA-BILLING-STG-001] real staging overview'), 'UI-CA-BILLING-STG-001');
  assert.equal(extractTestID('missing test ID'), '');
});

function configureReporter(t, values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function result(status, screenshot, options = {}) {
  return {
    retry: options.retry || 0,
    status,
    duration: options.duration || 25,
    startTime: new Date('2026-08-18T00:00:00.000Z'),
    attachments: [
      ...(screenshot ? [{ name: 'screenshot', contentType: 'image/png', path: screenshot }] : []),
      ...(options.attachments || []),
    ],
    error: options.error ? { message: options.error } : undefined,
  };
}

test('evidence reporter writes stable evidence and preserves a prior passing case', async (t) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-admin-evidence-'));
  const screenshot = path.join(runDir, 'attempt.png');
  const trace = path.join(runDir, 'trace.zip');
  const video = path.join(runDir, 'video.webm');
  const errorContext = path.join(runDir, 'error.md');
  fs.writeFileSync(screenshot, 'safe screenshot');
  for (const file of [trace, video, errorContext]) fs.writeFileSync(file, 'safe evidence');
  configureReporter(t, {
    E2E_TEST_RUN_DIR: runDir,
    E2E_TEST_RUN_ID: 'unit-reporter',
    E2E_TEST_TARGET: 'mobile',
    E2E_TEST_ENVIRONMENT: 'staging',
    E2E_EXPECTED_TEST_IDS: 'UI-CA-BILLING-STG-001,UI-CA-BILLING-STG-002',
    E2E_WORKSPACE_COMMIT: 'workspace-sha',
    E2E_SUBMODULE_COMMIT: 'submodule-sha',
  });
  const reporter = new EvidenceReporter();
  reporter.onBegin();
  reporter.onTestEnd({ title: '[UI-CA-BILLING-STG-001] overview @mobile' }, result('failed', screenshot, { error: 'first attempt', duration: 10 }));
  reporter.onTestEnd({ title: '[UI-CA-BILLING-STG-001] overview @mobile' }, result('passed', screenshot, {
    retry: 1,
    attachments: [
      { name: 'trace', contentType: 'application/zip', path: trace },
      { name: 'video', contentType: 'video/webm', path: video },
      { name: 'error-context', contentType: 'text/markdown', path: errorContext },
    ],
  }));
  reporter.onTestEnd({ title: '[UI-CA-BILLING-STG-002] invoice' }, result('skipped', screenshot));
  fs.writeFileSync(path.join(runDir, 'evidence-manifest.json'), `${JSON.stringify({ cases: [{
    test_id: 'UI-CA-BILLING-STG-002', assessment: 'PASS', status: 'PASS', purpose: 'prior pass',
    target: 'desktop', duration_ms: 1, started_at: 'old', completed_at: 'old', screenshot_path: 'old.png',
  }] })}\n`);

  assert.equal(await reporter.onEnd(), undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence-manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'PASS');
  assert.equal(manifest.cases[0].status, 'FLAKY');
  assert.equal(manifest.cases[0].attempts, 2);
  assert.equal(manifest.cases[0].target, 'mobile');
  assert.match(manifest.cases[0].screenshot_sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.cases[1].purpose, 'prior pass');
  assert.match(fs.readFileSync(path.join(runDir, 'junit.xml'), 'utf8'), /tests="2" failures="0"/);
  assert.match(fs.readFileSync(path.join(runDir, 'TEST_REPORT.md'), 'utf8'), /Overall assessment: \*\*PASS\*\*/);
  assert.equal(reporter.purposeByTestID('UI-CA-BILLING-STG-999'), 'Validate UI-CA-BILLING-STG-999 behavior defined by the catalog and Playwright test');
});

test('evidence reporter fails closed for invalid or incomplete evidence', async (t) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-admin-evidence-invalid-'));
  configureReporter(t, {
    E2E_TEST_RUN_DIR: runDir,
    E2E_TEST_RUN_ID: 'unit-reporter-invalid',
    E2E_EXPECTED_TEST_IDS: 'UI-CA-BILLING-STG-003',
  });
  const reporter = new EvidenceReporter();
  reporter.onBegin();
  reporter.onTestEnd({ title: 'missing governed ID' }, result('failed', ''));
  reporter.onTestEnd({ title: '[UI-CA-BILLING-STG-004] unsafe | title' }, result('failed', '', { error: '<upstream & failed>' }));
  fs.writeFileSync(path.join(runDir, 'evidence-manifest.json'), '{not json');

  assert.deepEqual(await reporter.onEnd(), { status: 'failed' });
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  assert.equal(manifest.status, 'FAIL');
  assert.equal(manifest.cases[0].status, 'FAIL');
  assert.equal(manifest.validation_errors.length, 4);
  assert.match(fs.readFileSync(path.join(runDir, 'junit.xml'), 'utf8'), /failures="1"/);
  assert.match(fs.readFileSync(path.join(runDir, 'junit.xml'), 'utf8'), /&lt;upstream &amp; failed&gt;/);
  assert.match(fs.readFileSync(path.join(runDir, 'TEST_REPORT.md'), 'utf8'), /## Validation errors/);
});
