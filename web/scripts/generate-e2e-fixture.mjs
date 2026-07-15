import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const webRoot = path.resolve(new URL('..', import.meta.url).pathname);
const repoRoot = path.resolve(webRoot, '..');
const workspaceRoot = path.resolve(repoRoot, '../..');
const loadtestRoot = path.join(workspaceRoot, 'loadtests', 'home-100k');
const scenario = process.env.E2E_SCENARIO || path.join(loadtestRoot, 'scenarios', 'cloud-admin-e2e.json');
const runID = process.env.E2E_RUN_ID || `cloud-admin-e2e-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
const outDir = process.env.E2E_FIXTURE_DIR || path.join(repoRoot, '.artifacts', 'e2e-fixtures', 'cloud-admin-e2e');
await mkdir(outDir, { recursive: true });

const args = ['run', './cmd/home-100k', 'generate-e2e-fixture', '--scenario', scenario, '--run-id', runID, '--out', outDir];
const child = spawn('go', args, { cwd: loadtestRoot, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', 'inherit', 'inherit'] });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
