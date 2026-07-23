import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TEST_ID = /\[(UI-[A-Z0-9]+-[A-Z0-9]+-\d{3})\]/;

function relative(runDir, value) {
  return value ? path.relative(runDir, value).split(path.sep).join('/') : '';
}

function markdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function xml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export default class EvidenceReporter {
  constructor() {
    this.runDir = path.resolve(process.env.E2E_TEST_RUN_DIR || '../../../.artifacts/test-runs/manual/ui/desktop');
    this.runID = process.env.E2E_TEST_RUN_ID || 'manual';
    this.target = process.env.E2E_TEST_TARGET || process.env.E2E_UI_TARGET || 'desktop';
    this.environment = process.env.E2E_TEST_ENVIRONMENT || 'local';
    this.expected = new Set((process.env.E2E_EXPECTED_TEST_IDS || '').split(',').filter(Boolean));
    this.attempts = new Map();
    this.errors = [];
  }

  onBegin() {
    fs.mkdirSync(path.join(this.runDir, 'evidence'), { recursive: true });
  }

  onTestEnd(test, result) {
    const match = test.title.match(TEST_ID);
    if (!match) {
      this.errors.push(`Playwright test is missing Test ID: ${test.title}`);
      return;
    }
    const testID = match[1];
    const attempts = this.attempts.get(testID) || [];
    attempts.push({
      title: test.title,
      retry: result.retry,
      status: result.status,
      duration_ms: result.duration,
      started_at: result.startTime.toISOString(),
      completed_at: new Date(result.startTime.getTime() + result.duration).toISOString(),
      attachments: result.attachments.map(({ name, contentType, path: attachmentPath }) => ({
        name,
        content_type: contentType,
        path: attachmentPath,
      })),
      error: result.error?.message || '',
    });
    this.attempts.set(testID, attempts);
  }

  async onEnd() {
    const records = [];
    for (const [testID, attempts] of [...this.attempts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const finalAttempt = attempts.at(-1);
      const screenshot = [...finalAttempt.attachments].reverse().find((item) => item.content_type === 'image/png' && item.path && fs.existsSync(item.path));
      const stableScreenshot = path.join(this.runDir, 'evidence', `${testID}.png`);
      let screenshotSHA256 = '';
      if (screenshot) {
        fs.copyFileSync(screenshot.path, stableScreenshot);
        screenshotSHA256 = crypto.createHash('sha256').update(fs.readFileSync(stableScreenshot)).digest('hex');
      } else {
        this.errors.push(`${testID}@${this.target} is missing its final viewport screenshot`);
      }
      const passed = finalAttempt.status === 'passed';
      const flaky = passed && attempts.length > 1 && attempts.some((attempt) => attempt.status !== 'passed');
      const status = flaky ? 'FLAKY' : passed ? 'PASS' : finalAttempt.status === 'skipped' ? 'SKIP' : 'FAIL';
      const traces = finalAttempt.attachments.filter((item) => item.name === 'trace').map((item) => relative(this.runDir, item.path));
      const videos = finalAttempt.attachments.filter((item) => item.content_type === 'video/webm').map((item) => relative(this.runDir, item.path));
      const errorContexts = finalAttempt.attachments.filter((item) => item.name === 'error-context').map((item) => relative(this.runDir, item.path));
      records.push({
        test_id: testID,
        target: this.target,
        environment: this.environment,
        purpose: this.purposeByTestID(testID),
        method: 'Playwright headless browser drives the UI through the real Go BFF and verifies observable UI/API behavior.',
        status,
        assessment: passed ? 'PASS' : 'FAIL',
        started_at: attempts[0].started_at,
        completed_at: finalAttempt.completed_at,
        duration_ms: attempts.reduce((sum, attempt) => sum + attempt.duration_ms, 0),
        attempts: attempts.length,
        screenshot_path: screenshot ? relative(this.runDir, stableScreenshot) : '',
        screenshot_sha256: screenshotSHA256,
        trace_paths: traces,
        video_paths: videos,
        error_context_paths: errorContexts,
        error_context: finalAttempt.error,
        workspace_commit: process.env.E2E_WORKSPACE_COMMIT || 'unknown',
        submodule_commit: process.env.E2E_SUBMODULE_COMMIT || 'unknown',
        run_id: this.runID,
        generated_at: new Date().toISOString(),
        raw_attempts: attempts.map((attempt) => ({
          ...attempt,
          attachments: attempt.attachments.map((item) => ({ ...item, path: relative(this.runDir, item.path) })),
        })),
      });
    }

    for (const testID of this.expected) {
      if (!this.attempts.has(testID)) {
        this.errors.push(`${testID}@${this.target} is required by tests/catalog.yaml but has no result`);
      }
    }
    const previousPath = path.join(this.runDir, 'evidence-manifest.json');
    let previous = [];
    if (fs.existsSync(previousPath)) {
      try {
        previous = JSON.parse(fs.readFileSync(previousPath, 'utf8')).cases || [];
      } catch {
        this.errors.push('existing evidence-manifest.json is unreadable');
      }
    }
    const merged = new Map(previous.map((item) => [item.test_id, item]));
    for (const item of records) {
      const old = merged.get(item.test_id);
      if (!old || item.assessment === 'PASS' || old.assessment !== 'PASS') merged.set(item.test_id, item);
    }
    const mergedRecords = [...merged.values()].sort((a, b) => a.test_id.localeCompare(b.test_id));
    const generatedAt = new Date().toISOString();
    const payload = {
      schema_version: 1,
      run_id: this.runID,
      target: this.target,
      environment: this.environment,
      workspace_commit: process.env.E2E_WORKSPACE_COMMIT || 'unknown',
      submodule_commit: process.env.E2E_SUBMODULE_COMMIT || 'unknown',
      generated_at: generatedAt,
      status: this.errors.length || mergedRecords.some((item) => item.assessment === 'FAIL') ? 'FAIL' : 'PASS',
      cases: mergedRecords,
      validation_errors: this.errors,
    };
    fs.writeFileSync(path.join(this.runDir, 'evidence-manifest.json'), `${JSON.stringify(payload, null, 2)}\n`);
    fs.writeFileSync(path.join(this.runDir, 'results.json'), `${JSON.stringify(payload, null, 2)}\n`);
    fs.writeFileSync(path.join(this.runDir, 'junit.xml'), this.renderJUnit(payload));
    fs.writeFileSync(path.join(this.runDir, 'TEST_REPORT.md'), this.renderMarkdown(payload));
    if (this.errors.length) {
      for (const error of this.errors) console.error(`evidence reporter: ${error}`);
      return { status: 'failed' };
    }
  }

  purposeByTestID(testID) {
    const attempts = this.attempts.get(testID) || [];
    const title = attempts.at(-1)?.title || '';
    return title
      .replace(TEST_ID, '')
      .replace(/\s+@[a-z0-9-]+/gi, '')
      .trim() || `Validate ${testID} behavior defined by the catalog and Playwright test`;
  }

  renderMarkdown(report) {
    const lines = [
      '# UI Test Report',
      '',
      `- Run ID: \`${report.run_id}\``,
      `- Target: \`${report.target}\``,
      `- Environment: \`${report.environment}\``,
      `- Generated at: \`${report.generated_at}\``,
      `- Workspace commit: \`${report.workspace_commit}\``,
      `- Submodule commit: \`${report.submodule_commit}\``,
      `- Overall assessment: **${report.status}**`,
      '',
      '| Test ID | Start time (UTC) | End time (UTC) | Duration ms | Purpose | Method | Result | Assessment | Evidence |',
      '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
    ];
    for (const item of report.cases) {
      lines.push(`| \`${item.test_id}\` | \`${item.started_at}\` | \`${item.completed_at}\` | ${item.duration_ms} | ${markdown(item.purpose)} | ${markdown(item.method)} | ${item.status} | **${item.assessment}** | \`${item.screenshot_path}\` |`);
    }
    if (report.validation_errors.length) {
      lines.push('', '## Validation errors', '');
      for (const error of report.validation_errors) lines.push(`- ${markdown(error)}`);
    }
    return `${lines.join('\n')}\n`;
  }

  renderJUnit(report) {
    const failures = report.cases.filter((item) => item.assessment === 'FAIL').length;
    const seconds = report.cases.reduce((sum, item) => sum + item.duration_ms, 0) / 1000;
    const cases = report.cases.map((item) => {
      const failure = item.assessment === 'FAIL'
        ? `<failure message="${xml(item.status)}">${xml(item.error_context || 'Test did not pass')}</failure>`
        : '';
      return `  <testcase classname="cloud_admin.ui.${xml(item.target)}" name="${xml(`${item.test_id} ${item.purpose}`)}" time="${(item.duration_ms / 1000).toFixed(3)}">${failure}</testcase>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="cloud-admin-ui-${xml(report.target)}" tests="${report.cases.length}" failures="${failures}" time="${seconds.toFixed(3)}">\n${cases.join('\n')}\n</testsuite>\n`;
  }
}
