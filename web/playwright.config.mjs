import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { outputFolder: '../.artifacts/playwright-report', open: 'never' }], ['line']] : [['html', { outputFolder: '../.artifacts/playwright-report', open: 'never' }], ['list']],
  outputDir: '../.artifacts/playwright-results',
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:18082', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', viewport: { width: 1440, height: 1000 } },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'node scripts/e2e-server.mjs', cwd: '.', url: 'http://127.0.0.1:18082/healthz', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', grep: /@smoke/, use: { ...devices['Pixel 7'] } },
    { name: 'staging', grep: /@staging/, use: { ...devices['Desktop Chrome'] } },
  ],
});
