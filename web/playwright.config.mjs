import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const target = process.env.E2E_TEST_TARGET || process.env.E2E_UI_TARGET || 'desktop';
const runDir = path.resolve(process.env.E2E_TEST_RUN_DIR || `../../../.artifacts/test-runs/manual/ui/${target}`);
const phase = process.env.E2E_TEST_PHASE || 'main';
const consoleReporter = process.env.CI ? 'line' : 'list';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { outputFolder: path.join(runDir, 'playwright-report', phase), open: 'never' }],
    ['./scripts/test-evidence-reporter.mjs'],
    [consoleReporter],
  ],
  outputDir: path.join(runDir, 'raw', phase),
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:18082', trace: 'retain-on-failure', screenshot: 'on', video: 'retain-on-failure', viewport: { width: 1440, height: 1000 } },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'node scripts/e2e-server.mjs', cwd: '.', url: 'http://127.0.0.1:18082/healthz', reuseExistingServer: false, timeout: 120_000 },
  projects: [
    { name: 'chromium', grepInvert: /@staging/, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', grep: /@smoke/, grepInvert: /@staging/, use: { ...devices['Pixel 7'] } },
    { name: 'staging', grep: /@staging/, use: { ...devices['Desktop Chrome'] } },
  ],
});
