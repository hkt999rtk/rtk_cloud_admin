import { test as base, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const compile = promisify(execFile);

// One isolated Go BFF/upstream/SQLite fixture per worker, on an OS-assigned
// loopback port. It cannot borrow a developer's server or staging session.
export const test = base.extend({
  scopedProductURL: [async ({}, use) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cloud-admin-scoped-ui-'));
    let child;
    let exited;
    try {
      const binary = path.join(dir, 'scoped-products.test');
      await compile('go', ['test', '-c', '-o', binary, './internal/app'], {
        cwd: repoRoot, env: { ...process.env, GOWORK: 'off' }, timeout: 90_000,
      });
      child = spawn(binary, ['-test.run=^TestScopedProductBrowserFixture$', '-test.timeout=10m'], {
        cwd: path.join(repoRoot, 'internal/app'),
        env: { ...process.env, SCOPED_PRODUCT_UI_FIXTURE: '1', SCOPED_PRODUCT_UI_PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      exited = new Promise(resolve => child.once('close', resolve));
      const url = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`Scoped fixture startup timed out: ${output}`)), 20_000);
        const fail = error => { clearTimeout(timer); reject(error); };
        child.once('error', fail);
        child.once('exit', code => fail(new Error(`Scoped fixture exited (${code}): ${output}`)));
        const read = chunk => {
          output = (output + chunk.toString()).slice(-8000);
          const match = output.match(/Disposable Product UI fixture: (http:\/\/127\.0\.0\.1:\d+)\r?\n/);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        };
        child.stdout.on('data', read);
        child.stderr.on('data', read);
      });
      await use(url);
    } finally {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(force);
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, { scope: 'worker', timeout: 120_000 }],
  baseURL: async ({ scopedProductURL }, use) => { await use(scopedProductURL); },
});

export { expect };
